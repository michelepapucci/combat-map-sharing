import { describe, expect, it } from 'vitest'
import { chunkKey, encodeChunk } from '../geometry/fog'
import { sampleCampaign } from '../state/fixtures/sampleCampaign'
import {
  FOG_CHUNK,
  FOG_CHUNK_BYTES,
  LAYER_NAMES,
  type AoeTemplate,
  type CampaignState,
  type FogEdit,
  type FogMask,
  type InitiativeEntry,
  type Item,
  type PlayerViewScene,
  type Scene,
  type SceneFog,
  type Token,
  type TokenKind,
  type ViewRect,
} from '../state/types'
import { projectForPlayers, type DevicePrefs, type ProjectionUi } from './projectForPlayers'

// ---------------------------------------------------------------------------
// Builders. Grid: 50 px cells of 5 ft, so 30 ft of vision is a 300 px radius.
// ---------------------------------------------------------------------------

const CELL = 50

function item(id: string, x: number, y: number, init: Partial<Item> = {}): Item {
  return {
    id,
    assetId: `asset-${id}`,
    name: `name-${id}`,
    x,
    y,
    width: CELL,
    height: CELL,
    rotation: 0,
    locked: false,
    hidden: false,
    opacity: 1,
    ...init,
  }
}

function token(
  id: string,
  kind: TokenKind,
  x: number,
  y: number,
  init: Partial<Token> = {},
): Token {
  return {
    ...item(id, x, y),
    kind,
    sizeCategory: 'medium',
    visionFt: null,
    label: null,
    showLabel: false,
    badge: null,
    hp: null,
    conditions: [],
    color: '#ef4444',
    dmNotes: `notes-${id}`,
    initiativeModifier: null,
    ...init,
  }
}

/** A player at the origin who sees 300 px around. */
const hero = (init: Partial<Token> = {}) => token('hero', 'player', 0, 0, { visionFt: 30, ...init })

function makeScene(init: Partial<Scene> = {}): Scene {
  return {
    id: 's1',
    name: 'Scene',
    grid: {
      type: 'square',
      size: CELL,
      offsetX: 0,
      offsetY: 0,
      feetPerCell: 5,
      visible: true,
      color: '#000000',
      opacity: 0.4,
    },
    layers: { map: [], props: [], tokens: [] },
    layerState: {
      map: { locked: true, visible: true },
      props: { locked: false, visible: true },
      tokens: { locked: false, visible: true },
    },
    fog: { enabled: false, exploredEnabled: true, manual: [] },
    initiative: { entries: [], activeEntryId: null, round: 1, visibleToPlayers: false },
    templates: [],
    ...init,
  }
}

function fogOn(init: Partial<SceneFog> = {}): SceneFog {
  return { enabled: true, exploredEnabled: true, manual: [], ...init }
}

function makeCampaign(scene: Scene, init: Partial<CampaignState> = {}): CampaignState {
  return {
    version: 2,
    id: 'c1',
    name: 'Campaign',
    scenes: [scene],
    activeSceneId: scene.id,
    sceneMemory: { [scene.id]: { explored: { cellPx: CELL / 4, chunks: {} }, playerView: null } },
    library: [],
    settings: {
      units: 'metric',
      diagonalRule: 'five',
      aoeCoverage: 'center',
      snapEnabled: true,
      shareRuler: false,
      npcVision: false,
    },
    presentation: { cameraMode: 'pushed', blackout: false, splashAssetId: null },
    createdAt: 0,
    updatedAt: 0,
    ...init,
  }
}

function setExplored(campaign: CampaignState, explored: FogMask): void {
  const memory = campaign.sceneMemory[campaign.activeSceneId]
  if (!memory) throw new Error('no scene memory')
  memory.explored = explored
}

/** A mask with the given cells (i, j) explored. */
function maskWith(cellPx: number, cells: [number, number][]): FogMask {
  const bytes = new Map<string, Uint8Array>()
  for (const [i, j] of cells) {
    const cx = Math.floor(i / FOG_CHUNK)
    const cy = Math.floor(j / FOG_CHUNK)
    const key = chunkKey(cx, cy)
    const bits = bytes.get(key) ?? new Uint8Array(FOG_CHUNK_BYTES)
    const k = (j - cy * FOG_CHUNK) * FOG_CHUNK + (i - cx * FOG_CHUNK)
    bits[k >> 3] = (bits[k >> 3] ?? 0) | (1 << (k & 7))
    bytes.set(key, bits)
  }
  const chunks: Record<string, string> = {}
  for (const [key, bits] of bytes) {
    const data = encodeChunk(bits)
    if (data !== null) chunks[key] = data
  }
  return { cellPx, chunks }
}

/** Every cell of a world rectangle, at 12.5 px per cell. */
function exploredRect(x0: number, y0: number, x1: number, y1: number): FogMask {
  const cellPx = CELL / 4
  const cells: [number, number][] = []
  for (let i = Math.floor(x0 / cellPx); i < Math.ceil(x1 / cellPx); i++) {
    for (let j = Math.floor(y0 / cellPx); j < Math.ceil(y1 / cellPx); j++) cells.push([i, j])
  }
  return maskWith(cellPx, cells)
}

const UI: ProjectionUi = {
  liveDrag: null,
  dmCamera: { x: 0, y: 0, zoom: 1 },
  dmViewport: { width: 0, height: 0 },
  measurement: null,
  tempTemplate: null,
}
const PREFS: DevicePrefs = { lockedCellPx: null }

function project(
  campaign: CampaignState,
  ui: Partial<ProjectionUi> = {},
  prefs: DevicePrefs = PREFS,
): PlayerViewScene {
  const state = projectForPlayers(campaign, { ...UI, ...ui }, prefs)
  if (state.blackout) throw new Error('unexpected blackout')
  return state.scene
}

const ids = (list: readonly { id: string }[]) => list.map((x) => x.id)

function template(id: string, visibleToPlayers: boolean): AoeTemplate {
  return {
    id,
    shape: 'circle',
    originX: 100,
    originY: 200,
    sizeFt: 20,
    widthFt: 5,
    directionDeg: 0,
    color: '#f59e0b',
    visibleToPlayers,
  }
}

function entry(id: string, init: Partial<InitiativeEntry> = {}): InitiativeEntry {
  return {
    id,
    tokenId: null,
    name: `Entry ${id}`,
    value: 10,
    dexTiebreak: null,
    manualOrder: 0,
    visibility: 'auto',
    ...init,
  }
}

/** Every object and array reachable from a value. */
function objectsIn(value: unknown, into = new Set<object>()): Set<object> {
  if (value !== null && typeof value === 'object' && !into.has(value)) {
    into.add(value)
    for (const child of Object.values(value)) objectsIn(child, into)
  }
  return into
}

/** A copy of the sample campaign with every part of the projection in use. */
function everything(): { campaign: CampaignState; ui: ProjectionUi } {
  const campaign = structuredClone(sampleCampaign)
  const scene = campaign.scenes[0]
  const chest = scene?.layers.props[0]
  if (!scene || !chest) throw new Error('unexpected sample')
  chest.hidden = false
  scene.initiative.activeEntryId = 'init-1'
  return {
    campaign,
    ui: {
      ...UI,
      measurement: {
        points: [
          { x: 455, y: 525 },
          { x: 735, y: 525 },
        ],
      },
      tempTemplate: template('temp', true),
    },
  }
}

// ---------------------------------------------------------------------------

describe('projectForPlayers on the sample campaign', () => {
  it('produces exactly the expected view', () => {
    expect(projectForPlayers(sampleCampaign, UI, PREFS)).toStrictEqual({
      blackout: false,
      scene: {
        sceneId: 'scene-1',
        grid: {
          size: 70,
          offsetX: 12,
          offsetY: 4,
          feetPerCell: 5,
          visible: true,
          color: '#000000',
          opacity: 0.35,
        },
        map: [
          {
            id: 'map-1',
            assetId: 'asset-map-1',
            x: 1400,
            y: 1050,
            width: 2800,
            height: 2100,
            rotation: 0,
            opacity: 1,
          },
        ],
        // The chest is hidden.
        props: [],
        tokens: [
          {
            id: 'token-1',
            assetId: 'builtin:token/circle-blue',
            x: 455,
            y: 525,
            width: 70,
            height: 70,
            rotation: 0,
            opacity: 1,
            color: '#3b82f6',
            label: null,
            badge: 'A',
            hpFraction: 0.75,
            conditions: ['prone'],
            // The lair action's turn is hidden: players still see Aria's turn (the last shown one).
            active: true,
          },
          {
            // In Aria's 60 ft (840 px) vision: shown, without its private label and HP.
            id: 'token-2',
            assetId: 'builtin:token/circle-red',
            x: 980,
            y: 700,
            width: 70,
            height: 70,
            rotation: 0,
            opacity: 1,
            color: '#ef4444',
            label: null,
            badge: null,
            hpFraction: null,
            conditions: [],
            active: false,
          },
        ],
        fog: {
          visible: [{ x: 455, y: 525, r: 840 }],
          explored: { cellPx: 17.5, chunks: { '0,0': 'AAEC', '-1,2': 'gA==' } },
          manual: [
            { mode: 'reveal', shape: { type: 'rect', x: 0, y: 0, width: 280, height: 210 } },
            { mode: 'hide', shape: { type: 'polygon', points: [0, 0, 70, 0, 35, 70] } },
            { mode: 'reveal', shape: { type: 'brush', points: [10, 10, 50, 60], radius: 20 } },
          ],
        },
        templates: [
          {
            id: 'aoe-1',
            shape: 'cone',
            originX: 455,
            originY: 525,
            sizeFt: 15,
            widthFt: 5,
            directionDeg: 30,
            color: '#f59e0b',
          },
        ],
        ruler: null,
        // The lair action (active, explicitly hidden) is omitted, and its turn shows
        // as Aria's, the last shown turn (round 2 wraps back), never as a gap.
        initiative: {
          round: 2,
          entries: [{ id: 'init-1', name: 'Aria', active: true, hpFraction: 0.75 }],
        },
        view: { x: 140, y: 70, width: 1680, height: 945 },
        lockedCellPx: null,
      },
    })
  })
})

const sortedKeys = (o: object) => Object.keys(o).toSorted()
const keys = (...names: string[]) => names.toSorted()

describe('exact keys of every player type', () => {
  const ITEM = ['id', 'assetId', 'x', 'y', 'width', 'height', 'rotation', 'opacity']

  it('blackout', () => {
    const campaign = makeCampaign(makeScene())
    campaign.presentation.blackout = true
    expect(sortedKeys(projectForPlayers(campaign, UI, PREFS))).toStrictEqual(
      keys('blackout', 'splashAssetId'),
    )
  })

  it('scene and everything in it', () => {
    const { campaign, ui } = everything()
    const state = projectForPlayers(campaign, ui, { lockedCellPx: 40 })
    expect(sortedKeys(state)).toStrictEqual(keys('blackout', 'scene'))
    if (state.blackout) throw new Error('unexpected blackout')
    const s = state.scene
    expect(sortedKeys(s)).toStrictEqual(
      keys(
        'sceneId',
        'grid',
        'map',
        'props',
        'tokens',
        'fog',
        'templates',
        'ruler',
        'initiative',
        'view',
        'lockedCellPx',
      ),
    )
    expect(sortedKeys(s.grid)).toStrictEqual(
      keys('size', 'offsetX', 'offsetY', 'feetPerCell', 'visible', 'color', 'opacity'),
    )
    expect(s.map.length + s.props.length).toBe(2)
    for (const x of [...s.map, ...s.props]) expect(sortedKeys(x)).toStrictEqual(keys(...ITEM))
    expect(s.tokens.length).toBe(2)
    for (const t of s.tokens) {
      expect(sortedKeys(t)).toStrictEqual(
        keys(...ITEM, 'color', 'label', 'badge', 'hpFraction', 'conditions', 'active'),
      )
    }
    const fog = s.fog
    if (!fog?.explored) throw new Error('expected fog with explored memory')
    expect(sortedKeys(fog)).toStrictEqual(keys('visible', 'explored', 'manual'))
    for (const c of fog.visible) expect(sortedKeys(c)).toStrictEqual(keys('x', 'y', 'r'))
    expect(sortedKeys(fog.explored)).toStrictEqual(keys('cellPx', 'chunks'))
    expect(fog.manual.map((e) => e.shape.type)).toStrictEqual(['rect', 'polygon', 'brush'])
    for (const e of fog.manual) expect(sortedKeys(e)).toStrictEqual(keys('mode', 'shape'))
    const [rect, polygon, brush] = fog.manual.map((e) => sortedKeys(e.shape))
    expect(rect).toStrictEqual(keys('type', 'x', 'y', 'width', 'height'))
    expect(polygon).toStrictEqual(keys('type', 'points'))
    expect(brush).toStrictEqual(keys('type', 'points', 'radius'))
    expect(s.templates.length).toBe(2)
    for (const t of s.templates) {
      expect(sortedKeys(t)).toStrictEqual(
        keys('id', 'shape', 'originX', 'originY', 'sizeFt', 'widthFt', 'directionDeg', 'color'),
      )
    }
    if (!s.ruler || !s.initiative) throw new Error('expected a ruler and a tracker')
    expect(sortedKeys(s.ruler)).toStrictEqual(keys('points', 'feet', 'cells', 'units'))
    for (const p of s.ruler.points) expect(sortedKeys(p)).toStrictEqual(keys('x', 'y'))
    expect(sortedKeys(s.initiative)).toStrictEqual(keys('round', 'entries'))
    expect(s.initiative.entries.length).toBe(1)
    for (const e of s.initiative.entries) {
      expect(sortedKeys(e)).toStrictEqual(keys('id', 'name', 'active', 'hpFraction'))
    }
    expect(sortedKeys(s.view)).toStrictEqual(keys('x', 'y', 'width', 'height'))
  })
})

describe('hidden things', () => {
  it('never sends hidden items, on any layer', () => {
    const campaign = makeCampaign(
      makeScene({
        layers: {
          map: [item('map', 0, 0), item('secret-map', 0, 0, { hidden: true })],
          props: [item('prop', 0, 0), item('secret-prop', 0, 0, { hidden: true })],
          tokens: [
            token('pc', 'player', 0, 0),
            token('secret-pc', 'player', 0, 0, { hidden: true }),
            token('secret-goblin', 'enemy', 0, 0, { hidden: true }),
          ],
        },
      }),
    )
    const s = project(campaign)
    expect(ids(s.map)).toStrictEqual(['map'])
    expect(ids(s.props)).toStrictEqual(['prop'])
    expect(ids(s.tokens)).toStrictEqual(['pc'])
    expect(JSON.stringify(s)).not.toContain('secret')
  })

  it('treats a malformed hidden flag as hidden', () => {
    const odd = token('odd', 'player', 0, 0, { hidden: undefined as unknown as boolean })
    const campaign = makeCampaign(makeScene({ layers: { map: [], props: [], tokens: [odd] } }))
    expect(project(campaign).tokens).toStrictEqual([])
  })

  it.each(LAYER_NAMES)('sends nothing from a hidden %s layer', (layer) => {
    const scene = makeScene({
      layers: {
        map: [item('map', 0, 0)],
        props: [item('prop', 0, 0)],
        tokens: [token('pc', 'player', 0, 0)],
      },
    })
    scene.layerState[layer].visible = false
    const s = project(makeCampaign(scene))
    expect(s[layer]).toStrictEqual([])
    for (const other of LAYER_NAMES.filter((l) => l !== layer)) expect(s[other].length).toBe(1)
  })

  it('a hidden tokens layer has no vision and hides its auto entries', () => {
    const scene = makeScene({
      fog: fogOn(),
      layers: { map: [], props: [], tokens: [hero()] },
      initiative: {
        entries: [entry('hero-turn', { tokenId: 'hero' }), entry('by-name')],
        activeEntryId: 'hero-turn',
        round: 1,
        visibleToPlayers: true,
      },
    })
    scene.layerState.tokens.visible = false
    const s = project(makeCampaign(scene))
    expect(s.tokens).toStrictEqual([])
    expect(s.fog?.visible).toStrictEqual([])
    expect(ids(s.initiative?.entries ?? [])).toStrictEqual(['by-name'])
  })
})

describe('fog', () => {
  it('fog off: every non-hidden item is sent and there is no fog data', () => {
    const campaign = makeCampaign(
      makeScene({
        fog: { enabled: false, exploredEnabled: true, manual: [] },
        layers: {
          map: [],
          props: [item('far-prop', 9000, 9000)],
          tokens: [token('far-goblin', 'enemy', 9000, 9000), token('far-ally', 'npc', -9000, 0)],
        },
      }),
    )
    const s = project(campaign)
    expect(ids(s.props)).toStrictEqual(['far-prop'])
    expect(ids(s.tokens)).toStrictEqual(['far-goblin', 'far-ally'])
    expect(s.fog).toBeNull()
  })

  it('sends NPCs and enemies only where currently visible, players always', () => {
    const campaign = makeCampaign(
      makeScene({
        fog: fogOn(),
        layers: {
          map: [],
          props: [],
          tokens: [
            hero(),
            token('near-goblin', 'enemy', 200, 0),
            token('far-goblin', 'enemy', 1000, 0),
            token('near-ally', 'npc', 0, 250),
            token('far-ally', 'npc', 0, 1000),
            token('lost-pc', 'player', 5000, 5000),
          ],
        },
      }),
    )
    expect(ids(project(campaign).tokens)).toStrictEqual([
      'hero',
      'near-goblin',
      'near-ally',
      'lost-pc',
    ])
  })

  it('explored-but-dim hides tokens but not props; black hides props too', () => {
    const scene = makeScene({
      fog: fogOn(),
      layers: {
        map: [],
        props: [item('seen-prop', 1000, 0), item('dark-prop', 3000, 0), item('lit-prop', 100, 0)],
        tokens: [hero(), token('dim-goblin', 'enemy', 1000, 0)],
      },
    })
    const campaign = makeCampaign(scene)
    setExplored(campaign, exploredRect(950, -50, 1050, 50))
    let s = project(campaign)
    expect(ids(s.props)).toStrictEqual(['seen-prop', 'lit-prop'])
    expect(ids(s.tokens)).toStrictEqual(['hero'])

    // With explored memory off, the explored area is black again.
    scene.fog.exploredEnabled = false
    s = project(campaign)
    expect(ids(s.props)).toStrictEqual(['lit-prop'])
    expect(s.fog?.explored).toBeNull()
  })

  it('a prop partly in the explored area is sent', () => {
    const campaign = makeCampaign(
      makeScene({
        fog: fogOn(),
        layers: { map: [], props: [item('edge', 1060, 0, { width: 40 })], tokens: [] },
      }),
    )
    setExplored(campaign, exploredRect(950, -50, 1050, 50)) // the prop's left edge is at 1040
    expect(ids(project(campaign).props)).toStrictEqual(['edge'])
  })

  it('manual reveal shows tokens, manual hide hides them, in order', () => {
    const around: FogEdit['shape'] = { type: 'rect', x: 1900, y: -100, width: 200, height: 200 }
    const reveal: FogEdit = { id: 'r', mode: 'reveal', shape: around }
    const hide: FogEdit = { id: 'h', mode: 'hide', shape: around }
    const scene = makeScene({
      fog: fogOn(),
      layers: { map: [], props: [], tokens: [hero(), token('goblin', 'enemy', 2000, 0)] },
    })
    const campaign = makeCampaign(scene)
    const shown = (manual: FogEdit[]) => {
      scene.fog.manual = manual
      return ids(project(campaign).tokens).includes('goblin')
    }
    expect(shown([])).toBe(false)
    expect(shown([reveal])).toBe(true)
    expect(shown([hide])).toBe(false)
    expect(shown([reveal, hide])).toBe(false)
    expect(shown([hide, reveal])).toBe(true)
  })

  it('a manual hide over vision hides tokens there', () => {
    const scene = makeScene({
      fog: fogOn({
        manual: [{ id: 'h', mode: 'hide', shape: { type: 'brush', points: [200, 0], radius: 60 } }],
      }),
      layers: { map: [], props: [], tokens: [hero(), token('goblin', 'enemy', 200, 0)] },
    })
    expect(ids(project(makeCampaign(scene)).tokens)).toStrictEqual(['hero'])
  })

  it('a hidden token is not a vision source', () => {
    const scene = makeScene({
      fog: fogOn(),
      layers: {
        map: [],
        props: [],
        tokens: [hero({ hidden: true }), token('goblin', 'enemy', 100, 0)],
      },
    })
    const s = project(makeCampaign(scene))
    expect(s.tokens).toStrictEqual([])
    expect(s.fog?.visible).toStrictEqual([])
    expect(JSON.stringify(s)).not.toContain('hero')
  })

  it('NPCs reveal fog only with npcVision', () => {
    const scene = makeScene({
      fog: fogOn(),
      layers: {
        map: [],
        props: [],
        tokens: [
          token('ally', 'npc', 0, 0, { visionFt: 30 }),
          token('goblin', 'enemy', 200, 0, { visionFt: 60 }),
        ],
      },
    })
    const campaign = makeCampaign(scene)
    let s = project(campaign)
    expect(s.tokens).toStrictEqual([])
    expect(s.fog?.visible).toStrictEqual([])

    campaign.settings.npcVision = true
    s = project(campaign)
    expect(ids(s.tokens)).toStrictEqual(['ally', 'goblin'])
    // Enemies never see for the players.
    expect(s.fog?.visible).toStrictEqual([{ x: 0, y: 0, r: 300 }])
  })

  it('sends a large token that is partly in view (nine sample points)', () => {
    const huge = { width: 200, height: 200, sizeCategory: 'gargantuan' } as const
    const scene = makeScene({
      fog: fogOn(),
      layers: {
        map: [],
        props: [],
        tokens: [
          hero(),
          // Center 390 px away (outside), left edge midpoint 290 px away (inside).
          token('in-reach', 'enemy', 390, 0, huge),
          // Nearest sample (left edge midpoint) 320 px away.
          token('out-of-reach', 'enemy', 420, 0, huge),
        ],
      },
    })
    expect(ids(project(makeCampaign(scene)).tokens)).toStrictEqual(['hero', 'in-reach'])
  })

  it('sends circles, explored memory and manual edits as data', () => {
    const scene = makeScene({
      fog: fogOn({
        manual: [
          {
            id: 'secret-edit-id',
            mode: 'reveal',
            shape: { type: 'rect', x: 1, y: 2, width: 3, height: 4 },
          },
        ],
      }),
      layers: { map: [], props: [], tokens: [hero()] },
    })
    const campaign = makeCampaign(scene)
    const explored = maskWith(CELL / 4, [[3, 4]])
    setExplored(campaign, explored)
    expect(project(campaign).fog).toStrictEqual({
      visible: [{ x: 0, y: 0, r: 300 }],
      explored: { cellPx: CELL / 4, chunks: explored.chunks },
      manual: [{ mode: 'reveal', shape: { type: 'rect', x: 1, y: 2, width: 3, height: 4 } }],
    })
  })

  it('treats missing scene memory as nothing explored', () => {
    const campaign = makeCampaign(makeScene({ fog: fogOn() }))
    campaign.sceneMemory = {}
    expect(project(campaign).fog?.explored).toStrictEqual({ cellPx: CELL / 4, chunks: {} })
  })

  it('copies only well-formed chunk keys', () => {
    const campaign = makeCampaign(makeScene({ fog: fogOn() }))
    setExplored(campaign, { cellPx: 10, chunks: { '0,-1': 'AQ==', 'not-a-key': 'AQ==' } })
    expect(project(campaign).fog?.explored).toStrictEqual({
      cellPx: 10,
      chunks: { '0,-1': 'AQ==' },
    })
  })
})

function dragScene(extra: Token[] = [], props: Item[] = []) {
  const scene = makeScene({
    fog: fogOn(),
    layers: { map: [], props, tokens: [hero(), ...extra] },
  })
  return makeCampaign(scene)
}

describe('live drags', () => {
  it('shows a player token at its live position; vision stays at the committed one', () => {
    const campaign = dragScene([
      token('near-goblin', 'enemy', 200, 0),
      token('goblin-at-destination', 'enemy', 2000, 100),
    ])
    const s = project(campaign, { liveDrag: { hero: { x: 2000, y: 0 } } })
    expect(s.tokens.find((t) => t.id === 'hero')).toMatchObject({ x: 2000, y: 0 })
    expect(s.fog?.visible).toStrictEqual([{ x: 0, y: 0, r: 300 }])
    expect(ids(s.tokens)).toStrictEqual(['hero', 'near-goblin'])
  })

  it('omits an enemy dragged into darkness, even from a visible start', () => {
    const campaign = dragScene([token('goblin', 'enemy', 100, 0)])
    const s = project(campaign, { liveDrag: { goblin: { x: 2000, y: 0 } } })
    expect(ids(s.tokens)).toStrictEqual(['hero'])
    expect(JSON.stringify(s)).not.toContain('goblin')
  })

  it('shows an enemy dragged within vision at its live position', () => {
    const campaign = dragScene([token('goblin', 'enemy', 100, 0)])
    const s = project(campaign, { liveDrag: { goblin: { x: 150, y: 50 } } })
    expect(s.tokens.find((t) => t.id === 'goblin')).toMatchObject({ x: 150, y: 50 })
  })

  it('shows an enemy dragged out of darkness into view', () => {
    const campaign = dragScene([token('ally', 'npc', 2000, 0)])
    const s = project(campaign, { liveDrag: { ally: { x: 100, y: 0 } } })
    expect(s.tokens.find((t) => t.id === 'ally')).toMatchObject({ x: 100, y: 0 })
  })

  it('applies the prop rule at the live position', () => {
    const campaign = dragScene([], [item('crate', 100, 0), item('barrel', 3000, 0)])
    const s = project(campaign, {
      liveDrag: { crate: { x: 3000, y: 3000 }, barrel: { x: 0, y: 100 } },
    })
    expect(s.props).toStrictEqual([
      {
        id: 'barrel',
        assetId: 'asset-barrel',
        x: 0,
        y: 100,
        width: 50,
        height: 50,
        rotation: 0,
        opacity: 1,
      },
    ])
  })

  it('with fog off, shows dragged items at their live position', () => {
    const campaign = makeCampaign(
      makeScene({ layers: { map: [], props: [], tokens: [token('goblin', 'enemy', 0, 0)] } }),
    )
    const s = project(campaign, { liveDrag: { goblin: { x: 7000, y: 7000 } } })
    expect(s.tokens.map((t) => [t.x, t.y])).toStrictEqual([[7000, 7000]])
  })

  it('ignores malformed live positions', () => {
    const campaign = dragScene([token('goblin', 'enemy', 100, 0)])
    const s = project(campaign, { liveDrag: { goblin: { x: Number.NaN, y: 0 } } })
    expect(s.tokens.find((t) => t.id === 'goblin')).toMatchObject({ x: 100, y: 0 })
  })
})

function blackedOut(splashAssetId: string | null): CampaignState {
  const campaign = makeCampaign(
    makeScene({ layers: { map: [item('map', 0, 0)], props: [], tokens: [hero()] } }),
  )
  const asset = sampleCampaign.library[0]
  if (!asset) throw new Error('unexpected sample')
  campaign.library = [{ ...structuredClone(asset), id: 'splash' }]
  campaign.presentation = { cameraMode: 'follow', blackout: true, splashAssetId }
  return campaign
}

describe('blackout', () => {
  it('sends nothing but the splash image', () => {
    expect(projectForPlayers(blackedOut('splash'), UI, { lockedCellPx: 40 })).toStrictEqual({
      blackout: true,
      splashAssetId: 'splash',
    })
  })

  it('drops a splash that is not an uploaded asset', () => {
    for (const id of ['builtin:map/dungeon', 'missing', null]) {
      expect(projectForPlayers(blackedOut(id), UI, PREFS)).toStrictEqual({
        blackout: true,
        splashAssetId: null,
      })
    }
  })

  it('fails closed when the active scene is missing', () => {
    const campaign = makeCampaign(makeScene())
    campaign.activeSceneId = 'gone'
    expect(projectForPlayers(campaign, UI, PREFS)).toStrictEqual({
      blackout: true,
      splashAssetId: null,
    })
  })
})

function tracked(init: Partial<Scene['initiative']> = {}, tokens?: Token[]) {
  const scene = makeScene({
    layers: {
      map: [],
      props: [],
      tokens: tokens ?? [
        token('goblin', 'enemy', 0, 0, { hp: { current: 3, max: 12, publicBar: true } }),
        token('orc', 'enemy', 100, 0, { hp: { current: 5, max: 10, publicBar: false } }),
        token('lurker', 'enemy', 200, 0, {
          hidden: true,
          hp: { current: 1, max: 4, publicBar: true },
        }),
      ],
    },
    initiative: {
      entries: [
        entry('goblin-turn', { tokenId: 'goblin', value: 12 }),
        entry('orc-turn', { tokenId: 'orc', value: 8, dexTiebreak: 3 }),
        entry('lurker-auto', { tokenId: 'lurker', value: 20 }),
        entry('lurker-shown', { tokenId: 'lurker', value: 15, visibility: 'shown' }),
        entry('gone-turn', { tokenId: 'gone', value: 18 }),
        entry('secret-turn', { value: 30, visibility: 'hidden' }),
        entry('lair', { value: 8, dexTiebreak: 5 }),
      ],
      activeEntryId: 'goblin-turn',
      round: 3,
      visibleToPlayers: true,
      ...init,
    },
  })
  return makeCampaign(scene)
}

/** The entry players see highlighted and the ringed tokens. */
function highlighted(init: Partial<Scene['initiative']>) {
  const s = project(tracked(init))
  return {
    entry: s.initiative?.entries.find((e) => e.active)?.id ?? null,
    ring: s.tokens.filter((t) => t.active).map((t) => t.id),
  }
}

describe('initiative', () => {
  it('is null while the tracker is not shown to players, with no active ring', () => {
    const s = project(tracked({ visibleToPlayers: false }))
    expect(s.initiative).toBeNull()
    expect(s.tokens.some((t) => t.active)).toBe(false)
  })

  it('lists visible entries in turn order, names only', () => {
    expect(project(tracked()).initiative).toStrictEqual({
      round: 3,
      entries: [
        // Shown by name, but its token is hidden: its public HP bar stays hidden too.
        { id: 'lurker-shown', name: 'Entry lurker-shown', active: false, hpFraction: null },
        { id: 'goblin-turn', name: 'Entry goblin-turn', active: true, hpFraction: 0.25 },
        { id: 'lair', name: 'Entry lair', active: false, hpFraction: null },
        { id: 'orc-turn', name: 'Entry orc-turn', active: false, hpFraction: null },
      ],
    })
  })

  it('rings the active token only while its entry is visible', () => {
    const activeIds = (campaign: CampaignState) =>
      project(campaign)
        .tokens.filter((t) => t.active)
        .map((t) => t.id)
    expect(activeIds(tracked())).toStrictEqual(['goblin'])
    expect(activeIds(tracked({ activeEntryId: 'orc-turn' }))).toStrictEqual(['orc'])
    expect(activeIds(tracked({ activeEntryId: 'lair' }))).toStrictEqual([])
    expect(activeIds(tracked({ activeEntryId: null }))).toStrictEqual([])

    // The active entry is explicitly hidden: the goblin is not ringed, and the
    // highlight stays on the last shown entry before it (its token is hidden: no ring).
    const campaign = tracked()
    const goblinTurn = campaign.scenes[0]?.initiative.entries[0]
    if (!goblinTurn) throw new Error('missing entry')
    goblinTurn.visibility = 'hidden'
    const s = project(campaign)
    expect(s.tokens.some((t) => t.active)).toBe(false)
    expect(s.initiative?.entries.filter((e) => e.active).map((e) => e.id)).toStrictEqual([
      'lurker-shown',
    ])
  })

  it('a hidden turn keeps the previous shown turn highlighted, never a gap', () => {
    // Turn order: secret 30 (hidden), lurker-auto 20 (hidden), gone 18 (hidden),
    // lurker-shown 15, goblin 12, lair 8, orc 8.
    expect(highlighted({ activeEntryId: 'gone-turn' })).toStrictEqual({
      entry: 'orc-turn', // round 3: wraps back to the end of round 2
      ring: ['orc'],
    })
    // Round 1: nothing shown has acted yet.
    expect(highlighted({ activeEntryId: 'gone-turn', round: 1 })).toStrictEqual({
      entry: null,
      ring: [],
    })
    expect(highlighted({ activeEntryId: 'lair' })).toStrictEqual({ entry: 'lair', ring: [] })
  })

  it('no HP bar in the tracker for a creature players cannot see on the map', () => {
    const campaign = tracked()
    const scene = campaign.scenes[0]
    if (!scene) throw new Error('no scene')
    // Fog on and no vision: the goblin is in the dark, so it is not sent at all.
    scene.fog.enabled = true
    const s = project(campaign)
    expect(s.tokens.map((t) => t.id)).toStrictEqual([])
    const goblin = s.initiative?.entries.find((e) => e.id === 'goblin-turn')
    expect(goblin).toStrictEqual({
      id: 'goblin-turn',
      name: 'Entry goblin-turn',
      active: true,
      hpFraction: null,
    })
  })

  it('never sends values, tiebreaks, manual order or token links', () => {
    const json = JSON.stringify(project(tracked()).initiative)
    for (const key of ['value', 'dexTiebreak', 'manualOrder', 'tokenId', 'visibility']) {
      expect(json).not.toContain(`"${key}"`)
    }
    expect(json).not.toContain('secret-turn')
    expect(json).not.toContain('gone-turn')
    expect(json).not.toContain('lurker-auto')
  })
})

const fraction = (hp: Token['hp']) => {
  const campaign = makeCampaign(
    makeScene({ layers: { map: [], props: [], tokens: [token('t', 'enemy', 0, 0, { hp })] } }),
  )
  return project(campaign).tokens[0]?.hpFraction
}

const withLabel = (showLabel: boolean) => {
  const t = token('t', 'enemy', 0, 0, { label: 'Grumpy', showLabel })
  const campaign = makeCampaign(makeScene({ layers: { map: [], props: [], tokens: [t] } }))
  return project(campaign)
}

describe('tokens', () => {
  it('sends an HP fraction only for public bars, clamped to 0..1', () => {
    expect(fraction({ current: 5, max: 20, publicBar: true })).toBe(0.25)
    expect(fraction({ current: 25, max: 20, publicBar: true })).toBe(1)
    expect(fraction({ current: -4, max: 20, publicBar: true })).toBe(0)
    expect(fraction({ current: 5, max: 0, publicBar: true })).toBeNull()
    expect(fraction({ current: 5, max: 20, publicBar: false })).toBeNull()
    expect(fraction(null)).toBeNull()
  })

  it('sends the label only when showLabel is on', () => {
    expect(withLabel(true).tokens[0]?.label).toBe('Grumpy')
    expect(withLabel(false).tokens[0]?.label).toBeNull()
    expect(JSON.stringify(withLabel(false))).not.toContain('Grumpy')
  })

  it('copies badge, color and conditions', () => {
    const t = token('t', 'npc', 0, 0, {
      badge: 'OC2',
      color: '#22c55e',
      conditions: ['prone', 'hexed'],
      rotation: 45,
      opacity: 0.5,
    })
    const campaign = makeCampaign(makeScene({ layers: { map: [], props: [], tokens: [t] } }))
    expect(project(campaign).tokens).toStrictEqual([
      {
        id: 't',
        assetId: 'asset-t',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        rotation: 45,
        opacity: 0.5,
        color: '#22c55e',
        label: null,
        badge: 'OC2',
        hpFraction: null,
        conditions: ['prone', 'hexed'],
        active: false,
      },
    ])
  })
})

function ruled(shareRuler: boolean, init: Partial<CampaignState['settings']> = {}) {
  const campaign = makeCampaign(makeScene())
  campaign.settings = { ...campaign.settings, shareRuler, ...init }
  return campaign
}

describe('ruler', () => {
  const points = [
    { x: 25, y: 25 },
    { x: 275, y: 125 },
    { x: 275, y: 375 },
  ]

  it('is not sent unless shared', () => {
    expect(project(ruled(false), { measurement: { points } }).ruler).toBeNull()
  })

  it('needs at least two points', () => {
    expect(project(ruled(true), { measurement: { points: points.slice(0, 1) } }).ruler).toBeNull()
    expect(project(ruled(true), { measurement: null }).ruler).toBeNull()
  })

  it('sends the points with precomputed cells, feet and units', () => {
    // (5, 2) cells then (0, 5) cells.
    expect(project(ruled(true), { measurement: { points } }).ruler).toStrictEqual({
      points,
      cells: 10,
      feet: 50,
      units: 'metric',
    })
    const alternating = project(ruled(true, { diagonalRule: 'alternating', units: 'imperial' }), {
      measurement: { points },
    }).ruler
    expect(alternating).toStrictEqual({ points, cells: 11, feet: 55, units: 'imperial' })
    const euclidean = project(ruled(true, { diagonalRule: 'euclidean' }), {
      measurement: { points },
    }).ruler
    expect(euclidean?.cells).toBeCloseTo(Math.hypot(5, 2) + 5)
  })

  it('uses the scene grid for feet', () => {
    const campaign = ruled(true)
    const grid = campaign.scenes[0]?.grid
    if (!grid) throw new Error('missing grid')
    grid.feetPerCell = 10
    expect(project(campaign, { measurement: { points } }).ruler?.feet).toBe(100)
  })
})

describe('templates', () => {
  it('sends pinned templates visible to players, then the temporary one', () => {
    const campaign = makeCampaign(
      makeScene({ templates: [template('shown', true), template('secret', false)] }),
    )
    expect(ids(project(campaign).templates)).toStrictEqual(['shown'])
    expect(
      ids(project(campaign, { tempTemplate: template('temp', true) }).templates),
    ).toStrictEqual(['shown', 'temp'])
    expect(
      ids(project(campaign, { tempTemplate: template('temp', false) }).templates),
    ).toStrictEqual(['shown'])
    expect(JSON.stringify(project(campaign))).not.toContain('visibleToPlayers')
  })
})

describe('view', () => {
  const map = item('map', 1000, 500, { width: 2000, height: 1000 })
  const mapBounds = { x: 0, y: 0, width: 2000, height: 1000 }

  function framed(
    cameraMode: CampaignState['presentation']['cameraMode'],
    playerView: ViewRect | null = null,
    sceneInit: Partial<Scene> = {},
  ) {
    const campaign = makeCampaign(
      makeScene({ layers: { map: [map], props: [], tokens: [] }, ...sceneInit }),
    )
    campaign.presentation.cameraMode = cameraMode
    const memory = campaign.sceneMemory['s1']
    if (memory) memory.playerView = playerView
    return campaign
  }

  const pushed = { x: 10, y: 20, width: 300, height: 200 }
  const following: Partial<ProjectionUi> = {
    dmCamera: { x: 500, y: 400, zoom: 2 },
    dmViewport: { width: 800, height: 600 },
  }

  it("'follow' mirrors the DM camera", () => {
    expect(project(framed('follow', pushed), following).view).toStrictEqual({
      x: 300,
      y: 250,
      width: 400,
      height: 300,
    })
  })

  it("'follow' without a DM viewport falls back like 'pushed'", () => {
    expect(project(framed('follow', pushed)).view).toStrictEqual(pushed)
    expect(project(framed('follow')).view).toStrictEqual(mapBounds)
  })

  it("'pushed' uses the stored view, or the default view", () => {
    expect(project(framed('pushed', pushed), following).view).toStrictEqual(pushed)
    expect(project(framed('pushed')).view).toStrictEqual(mapBounds)
  })

  it('the default view is the committed map, else 24 × 18 cells; tokens and drags never move it', () => {
    const tokens = [token('pc', 'player', 100, 100), token('lurker', 'enemy', 5000, 5000)]
    const withMap = framed('pushed', null, {
      layers: { map: [map], props: [item('crate', 100, 300)], tokens },
    })
    expect(project(withMap).view).toStrictEqual(mapBounds)
    // Dragging the map, or anything else, does not move the players' camera.
    const dragged = project(withMap, {
      liveDrag: { [map.id]: { x: 9000, y: 9000 }, pc: { x: 7000, y: 7000 } },
    })
    expect(dragged.view).toStrictEqual(mapBounds)

    // The map layer is hidden: the default rectangle, whatever tokens and props are sent.
    const hiddenMap = framed('pushed', null, {
      layers: { map: [map], props: [item('crate', 100, 300)], tokens },
    })
    const scene = hiddenMap.scenes[0]
    if (!scene) throw new Error('missing scene')
    scene.layerState.map.visible = false
    expect(project(hiddenMap).view).toStrictEqual({
      x: 0,
      y: 0,
      width: 24 * CELL,
      height: 18 * CELL,
    })

    // Hidden items do not count either.
    const empty = framed('pushed', null, {
      layers: { map: [{ ...map, hidden: true }], props: [], tokens: [] },
    })
    const grid = empty.scenes[0]?.grid
    if (!grid) throw new Error('missing grid')
    grid.offsetX = 7
    grid.offsetY = 9
    expect(project(empty).view).toStrictEqual({ x: 7, y: 9, width: 24 * CELL, height: 18 * CELL })
  })

  it("'fit-explored' frames explored memory, vision and manual reveals", () => {
    const campaign = framed('fit-explored', pushed, {
      fog: fogOn({
        manual: [
          {
            id: 'r',
            mode: 'reveal',
            shape: { type: 'rect', x: -100, y: 50, width: 50, height: 50 },
          },
          {
            id: 'h',
            mode: 'hide',
            shape: { type: 'rect', x: 5000, y: 5000, width: 50, height: 50 },
          },
        ],
      }),
      layers: {
        map: [map],
        props: [],
        tokens: [token('hero', 'player', 1000, 1000, { visionFt: 30 })],
      },
    })
    setExplored(
      campaign,
      maskWith(CELL / 4, [
        [0, 0],
        [10, 4],
      ]),
    )
    expect(project(campaign, following).view).toStrictEqual({
      x: -100,
      y: 0,
      width: 1400,
      height: 1300,
    })
  })

  it("'fit-explored' uses the default view when fog or explored memory is off, or nothing is seen", () => {
    const withMemory = (fog: SceneFog) => {
      const campaign = framed('fit-explored', pushed, {
        fog,
        layers: { map: [map], props: [], tokens: [] },
      })
      setExplored(campaign, maskWith(CELL / 4, [[400, 400]]))
      return campaign
    }
    expect(project(withMemory(fogOn())).view).toStrictEqual({
      x: 5000,
      y: 5000,
      width: 12.5,
      height: 12.5,
    })
    expect(project(withMemory(fogOn({ enabled: false }))).view).toStrictEqual(mapBounds)
    expect(project(withMemory(fogOn({ exploredEnabled: false }))).view).toStrictEqual(mapBounds)
    expect(project(framed('fit-explored', pushed, { fog: fogOn() })).view).toStrictEqual(mapBounds)
  })
})

describe('device preferences', () => {
  it('passes a positive locked cell size through', () => {
    const campaign = makeCampaign(makeScene())
    expect(project(campaign, {}, { lockedCellPx: 40 }).lockedCellPx).toBe(40)
    for (const bad of [null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(project(campaign, {}, { lockedCellPx: bad }).lockedCellPx).toBeNull()
    }
  })
})

describe('output', () => {
  it('shares no object or array with the input', () => {
    const { campaign, ui } = everything()
    const input = objectsIn([campaign, ui])
    const output = objectsIn(projectForPlayers(campaign, ui, PREFS))
    expect(output.size).toBeGreaterThan(20)
    for (const value of output) expect(input.has(value)).toBe(false)
  })

  it('is plain JSON', () => {
    const { campaign, ui } = everything()
    const state = projectForPlayers(campaign, ui, PREFS)
    expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state)
  })

  it('does not modify the input', () => {
    const { campaign, ui } = everything()
    const before = structuredClone({ campaign, ui })
    projectForPlayers(campaign, ui, PREFS)
    expect({ campaign, ui }).toStrictEqual(before)
  })
})
