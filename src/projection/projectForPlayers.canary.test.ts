import { describe, expect, it } from 'vitest'
import { visibleRect } from '../geometry/camera'
import { encodeChunk } from '../geometry/fog'
import {
  FOG_CHUNK_BYTES,
  type AssetMeta,
  type CampaignState,
  type InitiativeEntry,
  type InitiativeVisibility,
  type Item,
  type PlayerViewScene,
  type PlayerViewState,
  type Scene,
  type Token,
  type TokenKind,
  type UiState,
} from '../state/types'
import { projectForPlayers } from './projectForPlayers'

/**
 * The canary test (CLAUDE.md "Projection rule"): every string and number in a
 * campaign that uses every feature holds a unique canary, registered with the
 * conditions under which players may see it. Each projection is then searched
 * for every canary.
 */

type Leaf = string | number

/** When players may see a value. */
type Group =
  /** Never (names, notes, HP numbers, initiative values, hidden things, other scenes...). */
  | 'secret'
  /** In the base projection (fog on) and with fog off. */
  | 'shown'
  /** Only with fog off: NPCs, enemies and props the fog hides in the base projection. */
  | 'fogged'
  /** Only with fog on: explored memory and manual fog edits. */
  | 'fogData'
  /** Only in 'pushed' camera mode: the stored player view. */
  | 'pushedView'
  /** Only during blackout: the splash image id. */
  | 'splash'

const GROUPS: Group[] = ['secret', 'shown', 'fogged', 'fogData', 'pushedView', 'splash']

/** String fields holding enum values, which cannot be canaries (checked separately). */
const ENUM_KEYS = new Set([
  'type',
  'kind',
  'sizeCategory',
  'mode',
  'shape',
  'visibility',
  'cameraMode',
  'units',
  'diagonalRule',
  'aoeCoverage',
  'defaultSize',
  'defaultKind',
  'tool',
])

function isPrime(n: number): boolean {
  if (!Number.isInteger(n) || n < 2) return false
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false
  return true
}

function registry() {
  const all = new Set<Leaf>()
  const groups = Object.fromEntries(GROUPS.map((g) => [g, new Set<Leaf>()])) as Record<
    Group,
    Set<Leaf>
  >
  const add = <T extends Leaf>(group: Group, value: T): T => {
    if (all.has(value)) throw new Error(`canary ${value} registered twice`)
    all.add(value)
    groups[group].add(value)
    return value
  }
  let cursor = 100003
  const counters = { dim: 31, turn: 5, alpha: 501 }
  const scales = { dim: [1, 1], turn: [2, 4], alpha: [1, 1000] } as const
  let colorSeed = 0x10a000
  return {
    all,
    groups,
    str: (group: Group, name: string) => add(group, `CANARY_${name}`),
    num: (group: Group, value: number) => add(group, value),
    /** A string that cannot be a CANARY_ string (base64 fog chunks). */
    raw: (group: Group, value: string) => add(group, value),
    /** The first unused prime ≥ atLeast (default: the next one ≥ 100003). */
    prime(group: Group, atLeast?: number): number {
      let n = atLeast ?? cursor
      while (!isPrime(n) || all.has(n)) n++
      if (atLeast === undefined) cursor = n + 1
      return add(group, n)
    },
    /** Unique small numbers for sizes (31, 32...), rotations (1.25, 1.75...) and opacities (0.501...). */
    fresh(group: Group, kind: keyof typeof counters): number {
      const [step, scale] = scales[kind]
      let k = counters[kind]
      while (all.has(k / scale)) k += step
      counters[kind] = k + step
      return add(group, k / scale)
    },
    color(group: Group): string {
      colorSeed += 0x111
      return add(group, `#${colorSeed.toString(16).padStart(6, '0')}`)
    },
  }
}

function chunk(bytes: number[]): string {
  const bits = new Uint8Array(FOG_CHUNK_BYTES)
  bits.set(bytes)
  const data = encodeChunk(bits)
  if (data === null) throw new Error('empty chunk')
  return data
}

/** The canary campaign and DM UI state. Grid A: 50 px cells; the hero sees ~300 px around (2000, 2010). */
function canaryWorld() {
  const r = registry()
  const { str, num, prime, fresh, color } = r

  // Sent with the grid (PlayerGrid.feetPerCell): templates need it to size themselves.
  const feetPerCell = r.prime('shown')
  /** A secret vision range of about `cells` cells. */
  const vision = (cells: number) => prime('secret', cells * feetPerCell)
  const at = (group: Group, x: number, y: number): [number, number] => [
    num(group, x),
    num(group, y),
  ]
  const primeAt = (group: Group, x?: number, y?: number): [number, number] => [
    prime(group, x),
    prime(group, y),
  ]

  function itemOf(
    key: string,
    group: Group,
    [x, y]: [number, number],
    opts: { hidden?: boolean; assetId?: string } = {},
  ): Item {
    return {
      id: str(group, `${key}_id`),
      assetId: opts.assetId ?? str(group, `${key}_asset`),
      name: str('secret', `${key}_name`),
      x,
      y,
      width: fresh(group, 'dim'),
      height: fresh(group, 'dim'),
      rotation: fresh(group, 'turn'),
      locked: false,
      hidden: opts.hidden ?? false,
      opacity: fresh(group, 'alpha'),
    }
  }

  function tokenOf(
    key: string,
    group: Group,
    kind: TokenKind,
    position: [number, number],
    opts: {
      hidden?: boolean
      visionFt?: number
      label?: 'public' | 'private'
      hp?: 'public' | 'private'
    } = {},
  ): Token {
    return {
      ...itemOf(key, group, position, { hidden: opts.hidden }),
      kind,
      sizeCategory: 'medium',
      visionFt: opts.visionFt ?? null,
      label: opts.label ? str(opts.label === 'public' ? group : 'secret', `${key}_label`) : null,
      showLabel: opts.label === 'public',
      badge: str(group, `${key}_badge`),
      // current < max, so a public fraction is a real fraction.
      hp: opts.hp
        ? {
            current: prime('secret'),
            max: prime('secret', 9_000_000),
            publicBar: opts.hp === 'public',
          }
        : null,
      conditions: [str(group, `${key}_condition_1`), str(group, `${key}_condition_2`)],
      color: color(group),
      dmNotes: str('secret', `${key}_notes`),
      initiativeModifier: prime('secret'),
    }
  }

  function assetOf(id: string, kind: AssetMeta['kind']): AssetMeta {
    return {
      id,
      kind,
      name: str('secret', `${id}_name`),
      tags: [str('secret', `${id}_tag_1`), str('secret', `${id}_tag_2`)],
      mime: str('secret', `${id}_mime`),
      width: prime('secret'),
      height: prime('secret'),
      bytes: prime('secret'),
      hash: str('secret', `${id}_hash`),
      defaultSize: kind === 'token' ? 'large' : null,
      defaultKind: kind === 'token' ? 'npc' : null,
      defaultCells: kind === 'prop' ? { w: prime('secret'), h: prime('secret') } : null,
      localOnly: kind === 'prop',
      createdAt: prime('secret'),
    }
  }

  // --- Scene A (active) ------------------------------------------------------

  const mapAssetId = str('shown', 'asset_map_id')
  const grid: Scene['grid'] = {
    type: 'square',
    size: num('shown', 50),
    offsetX: num('shown', 7),
    offsetY: num('shown', 9),
    feetPerCell,
    visible: true,
    color: color('shown'),
    opacity: num('shown', 0.31),
  }

  const hero = tokenOf('hero', 'shown', 'player', at('shown', 2000, 2010), {
    visionFt: vision(6),
    label: 'public',
    hp: 'public',
  })
  const playerHidden = tokenOf('player_hidden', 'secret', 'player', primeAt('secret', 2203, 2213), {
    hidden: true,
    visionFt: vision(5),
    label: 'public',
    hp: 'public',
  })
  const enemyLit = tokenOf('enemy_lit', 'shown', 'enemy', at('shown', 2100, 2050), {
    visionFt: vision(7),
    label: 'private',
    hp: 'private',
  })
  const enemyDark = tokenOf('enemy_dark', 'fogged', 'enemy', primeAt('fogged', 20011, 20021), {
    hp: 'private',
  })
  const enemyDragged = tokenOf('enemy_dragged', 'fogged', 'enemy', primeAt('secret', 1979, 2129))
  const playerDragged = tokenOf('player_dragged', 'shown', 'player', primeAt('secret', 2311, 2333))
  const tokens: Token[] = [
    hero,
    playerHidden,
    tokenOf('npc_lit', 'shown', 'npc', at('shown', 1900, 2111), { visionFt: vision(4) }),
    enemyLit,
    // In the explored chunk "13,13" = world [10400, 11200): dimmed, so not sent.
    tokenOf('enemy_explored', 'fogged', 'enemy', primeAt('fogged', 10601, 10651)),
    enemyDark,
    tokenOf('npc_dark', 'fogged', 'npc', primeAt('fogged', 22003, 22013), { visionFt: vision(3) }),
    tokenOf('player_dark', 'shown', 'player', at('shown', 30001, 30011), { label: 'private' }),
    tokenOf('enemy_hidden', 'secret', 'enemy', at('secret', 2057, 1953), { hidden: true }),
    // Inside the manual reveal rectangle.
    tokenOf('enemy_revealed', 'shown', 'enemy', at('shown', 5050, 5060)),
    // Inside the reveal brush, then inside the later hide polygon.
    tokenOf('enemy_rehidden', 'fogged', 'enemy', primeAt('fogged', 7079, 7003)),
    enemyDragged,
    playerDragged,
  ]

  const entrySpecs: {
    key: string
    tokenId: string | null
    visibility: InitiativeVisibility
    group: Group
  }[] = [
    { key: 'hero', tokenId: hero.id, visibility: 'auto', group: 'shown' },
    { key: 'hidden_token', tokenId: playerHidden.id, visibility: 'auto', group: 'secret' },
    {
      key: 'missing_token',
      tokenId: str('secret', 'missing_token_id'),
      visibility: 'auto',
      group: 'secret',
    },
    { key: 'explicit_hidden', tokenId: enemyLit.id, visibility: 'hidden', group: 'secret' },
    { key: 'shown_hidden_token', tokenId: playerHidden.id, visibility: 'shown', group: 'shown' },
    // 'auto' follows the token's hidden flag, not the fog.
    { key: 'fogged_token', tokenId: enemyDark.id, visibility: 'auto', group: 'shown' },
    { key: 'by_name', tokenId: null, visibility: 'auto', group: 'shown' },
  ]
  const entries: InitiativeEntry[] = entrySpecs.map(({ key, tokenId, visibility, group }) => ({
    id: str(group, `entry_${key}_id`),
    tokenId,
    name: str(group, `entry_${key}_name`),
    value: prime('secret'),
    dexTiebreak: key === 'by_name' ? null : prime('secret'),
    manualOrder: prime('secret'),
    visibility,
  }))
  const heroEntry = entries[0]
  if (!heroEntry) throw new Error('no entries')

  const sceneA: Scene = {
    id: str('shown', 'sceneA_id'),
    name: str('secret', 'sceneA_name'),
    grid,
    layers: {
      map: [
        itemOf('map_shown', 'shown', at('shown', 1500, 1400), { assetId: mapAssetId }),
        itemOf('map_hidden', 'secret', primeAt('secret'), { hidden: true }),
        // Maps are always sent, even in the dark: fog covers them.
        itemOf('map_far', 'shown', at('shown', 40001, 40003)),
      ],
      props: [
        itemOf('prop_lit', 'shown', at('shown', 1951, 1903)),
        itemOf('prop_explored', 'shown', at('shown', 10701, 10751)),
        itemOf('prop_dark', 'fogged', primeAt('fogged', 25013, 25031)),
        itemOf('prop_hidden', 'secret', at('secret', 1990, 2020), { hidden: true }),
      ],
      tokens,
    },
    layerState: {
      map: { locked: true, visible: true },
      props: { locked: false, visible: true },
      tokens: { locked: false, visible: true },
    },
    fog: {
      enabled: true,
      exploredEnabled: true,
      manual: [
        {
          id: str('secret', 'fog_edit_rect_id'),
          mode: 'reveal',
          shape: {
            type: 'rect',
            x: num('fogData', 5003.5),
            y: num('fogData', 5011.5),
            width: num('fogData', 120.5),
            height: num('fogData', 121.5),
          },
        },
        {
          id: str('secret', 'fog_edit_brush_id'),
          mode: 'reveal',
          shape: {
            type: 'brush',
            points: [7000.5, 7003.5, 7100.5, 7003.25].map((v) => num('fogData', v)),
            radius: num('fogData', 40.5),
          },
        },
        {
          id: str('secret', 'fog_edit_polygon_id'),
          mode: 'hide',
          shape: {
            type: 'polygon',
            points: [7040.5, 6950.5, 7120.5, 6950.25, 7120.25, 7060.5, 7040.25, 7060.25].map((v) =>
              num('fogData', v),
            ),
          },
        },
      ],
    },
    initiative: {
      entries,
      activeEntryId: heroEntry.id,
      round: num('shown', 6),
      visibleToPlayers: true,
    },
    templates: [
      {
        id: str('shown', 'template_shown_id'),
        shape: 'cone',
        originX: num('shown', 601),
        originY: num('shown', 603),
        sizeFt: num('shown', 25),
        widthFt: num('shown', 10),
        directionDeg: num('shown', 233),
        color: color('shown'),
        visibleToPlayers: true,
      },
      {
        id: str('secret', 'template_secret_id'),
        shape: 'line',
        originX: prime('secret'),
        originY: prime('secret'),
        sizeFt: prime('secret'),
        widthFt: prime('secret'),
        directionDeg: prime('secret'),
        color: color('secret'),
        visibleToPlayers: false,
      },
    ],
  }

  // --- Scene B (inactive): nothing of it may ever be sent --------------------

  const bHero = tokenOf('b_hero', 'secret', 'player', primeAt('secret'), {
    visionFt: prime('secret'),
    label: 'public',
    hp: 'public',
  })
  const bEntryId = str('secret', 'b_entry_id')
  const sceneB: Scene = {
    id: str('secret', 'sceneB_id'),
    name: str('secret', 'sceneB_name'),
    grid: {
      type: 'square',
      size: prime('secret'),
      offsetX: prime('secret'),
      offsetY: prime('secret'),
      feetPerCell: prime('secret'),
      visible: true,
      color: color('secret'),
      opacity: fresh('secret', 'alpha'),
    },
    layers: {
      map: [itemOf('b_map', 'secret', primeAt('secret'))],
      props: [itemOf('b_prop', 'secret', primeAt('secret'))],
      tokens: [bHero],
    },
    layerState: {
      map: { locked: true, visible: true },
      props: { locked: false, visible: true },
      tokens: { locked: false, visible: true },
    },
    fog: {
      enabled: true,
      exploredEnabled: true,
      manual: [
        {
          id: str('secret', 'b_fog_edit_id'),
          mode: 'reveal',
          shape: {
            type: 'rect',
            x: prime('secret'),
            y: prime('secret'),
            width: prime('secret'),
            height: prime('secret'),
          },
        },
      ],
    },
    initiative: {
      entries: [
        {
          id: bEntryId,
          tokenId: bHero.id,
          name: str('secret', 'b_entry_name'),
          value: prime('secret'),
          dexTiebreak: prime('secret'),
          manualOrder: prime('secret'),
          visibility: 'shown',
        },
      ],
      activeEntryId: bEntryId,
      round: prime('secret'),
      visibleToPlayers: true,
    },
    templates: [
      {
        id: str('secret', 'b_template_id'),
        shape: 'circle',
        originX: prime('secret'),
        originY: prime('secret'),
        sizeFt: prime('secret'),
        widthFt: prime('secret'),
        directionDeg: prime('secret'),
        color: color('secret'),
        visibleToPlayers: true,
      },
    ],
  }

  // --- Campaign ----------------------------------------------------------------

  const splashId = str('splash', 'asset_splash_id')
  const campaign: CampaignState = {
    version: prime('secret'),
    id: str('secret', 'campaign_id'),
    name: str('secret', 'campaign_name'),
    scenes: [sceneA, sceneB],
    activeSceneId: sceneA.id,
    sceneMemory: {
      [sceneA.id]: {
        explored: {
          cellPx: num('fogData', 12.5),
          chunks: {
            '13,13': r.raw('fogData', chunk(Array.from({ length: FOG_CHUNK_BYTES }, () => 255))),
            '-3,-2': r.raw('fogData', chunk([0, 0x10, 0x20])),
          },
        },
        playerView: {
          x: num('pushedView', 1301),
          y: num('pushedView', 1303),
          width: num('pushedView', 1709),
          height: num('pushedView', 961),
        },
      },
      [sceneB.id]: {
        explored: {
          cellPx: prime('secret'),
          chunks: { '0,0': r.raw('secret', chunk([0x55, 0x01])) },
        },
        playerView: {
          x: prime('secret'),
          y: prime('secret'),
          width: prime('secret'),
          height: prime('secret'),
        },
      },
      [str('secret', 'orphan_scene_id')]: {
        explored: { cellPx: prime('secret'), chunks: { '2,2': r.raw('secret', chunk([0x0f])) } },
        playerView: null,
      },
    },
    library: [
      assetOf(mapAssetId, 'map'),
      assetOf(splashId, 'map'),
      assetOf(str('secret', 'asset_prop_id'), 'prop'),
      assetOf(str('secret', 'asset_token_id'), 'token'),
    ],
    settings: {
      units: 'imperial',
      diagonalRule: 'alternating',
      aoeCoverage: 'half',
      snapEnabled: true,
      shareRuler: true,
      npcVision: false,
    },
    presentation: { cameraMode: 'pushed', blackout: false, splashAssetId: splashId },
    createdAt: prime('secret'),
    updatedAt: prime('secret'),
  }

  const ui: UiState = {
    tool: 'select',
    selection: [str('secret', 'selection_id')],
    dmCamera: { x: prime('secret'), y: prime('secret'), zoom: num('secret', 2.5) },
    dmViewport: { width: prime('secret'), height: prime('secret') },
    measurement: {
      points: [
        { x: num('shown', 101), y: num('shown', 103) },
        { x: num('shown', 401), y: num('shown', 107) },
        { x: num('shown', 409), y: num('shown', 413) },
      ],
    },
    tempTemplate: {
      id: str('shown', 'template_temp_id'),
      shape: 'circle',
      originX: num('shown', 701),
      originY: num('shown', 703),
      sizeFt: num('shown', 15),
      widthFt: num('shown', 5),
      directionDeg: num('shown', 0.75),
      color: color('shown'),
      visibleToPlayers: true,
    },
    previewAsPlayers: false,
    liveDrag: {
      [enemyDragged.id]: { x: prime('fogged', 30103), y: prime('fogged', 30113) },
      [playerDragged.id]: { x: num('shown', 1801), y: num('shown', 1811) },
    },
  }

  return { campaign, ui, groups: r.groups, all: r.all, splashId, hero, playerHidden, entries }
}

// ---------------------------------------------------------------------------

/** Every string and number leaf under a value, with the key it is stored under. */
function leaves(
  value: unknown,
  key = '',
  into: { key: string; value: Leaf }[] = [],
): { key: string; value: Leaf }[] {
  if (typeof value === 'string' || typeof value === 'number') into.push({ key, value })
  else if (Array.isArray(value)) for (const v of value) leaves(v, key, into)
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) leaves(v, k, into)
  }
  return into
}

/**
 * Whether a projection contains a canary: strings anywhere in the JSON (values
 * and keys, matched with their quotes), numbers as exact leaf values.
 */
function finder(state: PlayerViewState): (value: Leaf) => boolean {
  const json = JSON.stringify(state)
  const numbers = new Set(leaves(state).map((l) => l.value))
  return (value) =>
    typeof value === 'string' ? json.includes(JSON.stringify(value)) : numbers.has(value)
}

function expectAbsent(state: PlayerViewState, values: Iterable<Leaf>): void {
  const has = finder(state)
  expect([...values].filter(has)).toStrictEqual([])
}

function expectPresent(state: PlayerViewState, values: Iterable<Leaf>): void {
  const has = finder(state)
  expect([...values].filter((v) => !has(v))).toStrictEqual([])
}

function sceneOf(state: PlayerViewState): PlayerViewScene {
  if (state.blackout) throw new Error('unexpected blackout')
  return state.scene
}

function activeScene(campaign: CampaignState): Scene {
  const scene = campaign.scenes[0]
  if (!scene) throw new Error('no scene')
  return scene
}

function objectsIn(value: unknown, into = new Set<object>()): Set<object> {
  if (value !== null && typeof value === 'object' && !into.has(value)) {
    into.add(value)
    for (const child of Object.values(value)) objectsIn(child, into)
  }
  return into
}

const PREFS = { lockedCellPx: null }

/**
 * Keys of DM-only campaign fields; none may appear anywhere in a projection.
 * (`name` is a key of player initiative entries; name values are canaries.)
 */
const DM_ONLY_KEYS = [
  'dmNotes',
  'hp',
  'current',
  'max',
  'publicBar',
  'kind',
  'hidden',
  'locked',
  'visionFt',
  'initiativeModifier',
  'sizeCategory',
  'showLabel',
  'value',
  'dexTiebreak',
  'manualOrder',
  'visibility',
  'tokenId',
  'activeEntryId',
  'visibleToPlayers',
  'playerView',
  'sceneMemory',
  'library',
  'settings',
  'presentation',
  'tags',
  'hash',
  'mime',
  'bytes',
  'selection',
  'dmCamera',
  'tool',
]

/** Values of DM-only enum fields (token kind, size, entry visibility, settings, tool). */
const DM_ONLY_ENUM_VALUES = [
  'player',
  'npc',
  'enemy',
  'medium',
  'large',
  'auto',
  'hidden',
  'shown',
  'alternating',
  'half',
  'pushed',
  'select',
  'square',
]

describe('canary campaign', () => {
  it('holds a registered canary in every string and number field, and uses every canary', () => {
    const { campaign, ui, all } = canaryWorld()
    const found = leaves([campaign, ui])
    const unregistered = found.filter(
      ({ key, value }) => !(typeof value === 'string' && ENUM_KEYS.has(key)) && !all.has(value),
    )
    expect(unregistered).toStrictEqual([])
    // Some canaries are object keys (scene memory of a deleted scene), so search the JSON too.
    const json = JSON.stringify([campaign, ui])
    const values = new Set(found.map((l) => l.value))
    const unused = [...all].filter(
      (v) => !values.has(v) && !(typeof v === 'string' && json.includes(JSON.stringify(v))),
    )
    expect(unused).toStrictEqual([])
  })

  it('base projection (fog on): only whitelisted canaries reach players', () => {
    const { campaign, ui, groups } = canaryWorld()
    const state = projectForPlayers(campaign, ui, PREFS)
    expectAbsent(state, [...groups.secret, ...groups.fogged, ...groups.splash])
    expectPresent(state, [...groups.shown, ...groups.fogData, ...groups.pushedView])
    // Only the hero sees: not the hidden player, the NPCs (npcVision off) or enemies.
    expect(sceneOf(state).fog?.visible).toHaveLength(1)
  })

  it('fog off: fogged things are sent, fog data is not', () => {
    const { campaign, ui, groups } = canaryWorld()
    activeScene(campaign).fog.enabled = false
    const state = projectForPlayers(campaign, ui, PREFS)
    expectAbsent(state, [...groups.secret, ...groups.fogData, ...groups.splash])
    expectPresent(state, [...groups.shown, ...groups.fogged, ...groups.pushedView])
    expect(sceneOf(state).fog).toBeNull()
  })

  it('blackout: nothing but the splash id', () => {
    const { campaign, ui, all, splashId } = canaryWorld()
    campaign.presentation.blackout = true
    const state = projectForPlayers(campaign, ui, { lockedCellPx: 40 })
    expect(state).toStrictEqual({ blackout: true, splashAssetId: splashId })
    expectAbsent(
      state,
      [...all].filter((v) => v !== splashId),
    )
  })

  it('hidden layers: none of their items, no vision, auto entries hidden', () => {
    const { campaign, ui, groups, entries } = canaryWorld()
    const scene = activeScene(campaign)
    scene.layerState.map.visible = false
    scene.layerState.props.visible = false
    scene.layerState.tokens.visible = false
    const state = projectForPlayers(campaign, ui, PREFS)
    expectAbsent(state, [...groups.secret, ...groups.fogged, ...groups.splash])
    const s = sceneOf(state)
    expect([s.map, s.props, s.tokens, s.fog?.visible]).toStrictEqual([[], [], [], []])
    const expected = entries
      .filter((e) => e.tokenId === null || e.visibility === 'shown')
      .map((e) => e.id)
    expect(s.initiative?.entries.map((e) => e.id).toSorted()).toStrictEqual(expected.toSorted())
  })

  it("'follow' mode: the pushed view is not sent", () => {
    const { campaign, ui, groups } = canaryWorld()
    campaign.presentation.cameraMode = 'follow'
    const state = projectForPlayers(campaign, ui, PREFS)
    expectAbsent(state, [
      ...groups.secret,
      ...groups.fogged,
      ...groups.splash,
      ...groups.pushedView,
    ])
    expect(sceneOf(state).view).toStrictEqual(visibleRect(ui.dmCamera, ui.dmViewport))
  })

  it('tracker, ruler and templates hidden from players', () => {
    const { campaign, ui, groups, entries } = canaryWorld()
    const scene = activeScene(campaign)
    scene.initiative.visibleToPlayers = false
    campaign.settings.shareRuler = false
    for (const t of scene.templates) t.visibleToPlayers = false
    if (ui.tempTemplate) ui.tempTemplate.visibleToPlayers = false
    const state = projectForPlayers(campaign, ui, PREFS)
    expectAbsent(state, [...groups.secret, ...groups.fogged, ...groups.splash])
    expectAbsent(state, [
      ...entries.flatMap((e) => [e.id, e.name]),
      ...(ui.measurement?.points.flatMap((p) => [p.x, p.y]) ?? []),
      ...[...scene.templates, ...(ui.tempTemplate ? [ui.tempTemplate] : [])].flatMap((t) => [
        t.id,
        t.color,
        t.originX,
      ]),
    ])
    const s = sceneOf(state)
    expect([s.initiative, s.ruler, s.templates]).toStrictEqual([null, null, []])
    expect(s.tokens.some((t) => t.active)).toBe(false)
  })

  it('never sends DM-only keys or enum values', () => {
    const { campaign, ui } = canaryWorld()
    const withFog = JSON.stringify(projectForPlayers(campaign, ui, PREFS))
    activeScene(campaign).fog.enabled = false
    const withoutFog = JSON.stringify(projectForPlayers(campaign, ui, PREFS))
    for (const json of [withFog, withoutFog]) {
      for (const key of DM_ONLY_KEYS) expect(json).not.toContain(`"${key}":`)
      for (const value of DM_ONLY_ENUM_VALUES) expect(json).not.toContain(JSON.stringify(value))
    }
  })

  it('rings the active token and keeps the public HP bar as a fraction only', () => {
    const { campaign, ui, hero } = canaryWorld()
    const s = sceneOf(projectForPlayers(campaign, ui, PREFS))
    const sent = s.tokens.find((t) => t.id === hero.id)
    expect(sent?.active).toBe(true)
    expect(s.tokens.filter((t) => t.active)).toHaveLength(1)
    expect(sent?.hpFraction).toBe((hero.hp?.current ?? NaN) / (hero.hp?.max ?? NaN))
    expect(sent?.label).toBe(hero.label)
  })

  it('shares no references with the input and leaves it unchanged', () => {
    const { campaign, ui } = canaryWorld()
    const before = structuredClone({ campaign, ui })
    const input = objectsIn([campaign, ui])
    for (const blackout of [false, true]) {
      campaign.presentation.blackout = blackout
      for (const value of objectsIn(projectForPlayers(campaign, ui, PREFS))) {
        expect(input.has(value)).toBe(false)
      }
    }
    campaign.presentation.blackout = false
    expect({ campaign, ui }).toStrictEqual(before)
  })
})
