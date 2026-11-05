import { visibleRect } from '../geometry/camera'
import { rulerLength } from '../geometry/ruler'
import {
  exploredBounds,
  footprintRegion,
  shapeBounds,
  visionSources,
  type Footprint,
  type VisionCircle,
} from '../geometry/fog'
import { effectiveVisibility, sortInitiative } from '../geometry/initiative'
import { itemBounds, unionRects } from '../geometry/rect'
import type { Point, Rect } from '../geometry/types'
import type {
  AoeTemplate,
  CampaignState,
  Camera,
  FogMask,
  FogShape,
  Grid,
  Id,
  InitiativeEntry,
  Item,
  Measurement,
  PlayerFog,
  PlayerFogMask,
  PlayerGrid,
  PlayerInitiative,
  PlayerItem,
  PlayerRuler,
  PlayerTemplate,
  PlayerToken,
  PlayerViewScene,
  PlayerViewState,
  Scene,
  SceneMemory,
  Settings,
  Token,
  TokenHp,
  ViewRect,
} from '../state/types'

/**
 * The security boundary (CLAUDE.md "Projection rule"): the only producer of
 * campaign-derived data for the player window.
 *
 * - Whitelist, never spread: every output object is a fresh object literal built
 *   field by field, so a field added to the campaign types never reaches players
 *   by accident, and the output shares no references with the input.
 * - Fail closed: flags are tested as `hidden !== false` and `visible === true`,
 *   so a malformed document hides things rather than revealing them.
 */

/** The transient DM state the projection reads (UiState is a superset). */
export interface ProjectionUi {
  liveDrag: Record<Id, { x: number; y: number }> | null
  dmCamera: Camera
  dmViewport: { width: number; height: number }
  measurement: Measurement | null
  tempTemplate: AoeTemplate | null
}

/** Preferences of the DM's device that shape the player view. */
export interface DevicePrefs {
  lockedCellPx: number | null
}

/** The default view when nothing else frames the scene: 24 × 18 cells at the grid origin. */
export const DEFAULT_VIEW_CELLS = { width: 24, height: 18 } as const

export function projectForPlayers(
  campaign: CampaignState,
  ui: ProjectionUi,
  prefs: DevicePrefs,
): PlayerViewState {
  if (campaign.presentation.blackout !== false) {
    return { blackout: true, splashAssetId: splashAssetId(campaign) }
  }
  const scene = campaign.scenes.find((s) => s.id === campaign.activeSceneId)
  // activeSceneId always names a scene (validator, Decision 51); if not, show nothing.
  if (!scene) return { blackout: true, splashAssetId: null }
  return { blackout: false, scene: projectScene(campaign, scene, ui, prefs) }
}

/** The splash image only if it is an uploaded asset of this campaign. */
function splashAssetId(campaign: CampaignState): Id | null {
  const id = campaign.presentation.splashAssetId
  if (typeof id !== 'string') return null
  return campaign.library.some((asset) => asset.id === id) ? id : null
}

function projectScene(
  campaign: CampaignState,
  scene: Scene,
  ui: ProjectionUi,
  prefs: DevicePrefs,
): PlayerViewScene {
  const memory: SceneMemory | undefined = Object.hasOwn(campaign.sceneMemory, scene.id)
    ? campaign.sceneMemory[scene.id]
    : undefined
  const explored: FogMask = memory?.explored ?? { cellPx: scene.grid.size / 4, chunks: {} }
  const fogOn = scene.fog.enabled !== false
  // Vision always uses committed positions: live drags never move it.
  const circles: VisionCircle[] = fogOn ? visionSources(scene, campaign.settings) : []
  const regionOf = (footprint: Footprint) =>
    footprintRegion(footprint, scene.fog, circles, explored)

  // Map images are the deliberate exception: always sent, fog covers them.
  const map: PlayerItem[] = []
  if (scene.layerState.map.visible === true) {
    for (const item of scene.layers.map) {
      if (item.hidden !== false) continue
      map.push(playerItem(item, livePosition(ui, item.id) ?? item))
    }
  }

  // Props: sent unless their whole footprint is in black (unexplored) fog.
  const props: PlayerItem[] = []
  if (scene.layerState.props.visible === true) {
    for (const item of scene.layers.props) {
      if (item.hidden !== false) continue
      const at = livePosition(ui, item.id) ?? item
      if (regionOf(placed(item, at)) === 'dark') continue
      props.push(playerItem(item, at))
    }
  }

  // Tokens: players always; NPCs and enemies only where currently visible. A
  // dragged NPC or enemy is checked at its live position, against committed vision.
  const activeTokenId = shownTurn(scene)?.tokenId ?? null
  const tokens: PlayerToken[] = []
  if (scene.layerState.tokens.visible === true) {
    for (const token of scene.layers.tokens) {
      if (token.hidden !== false) continue
      const at = livePosition(ui, token.id) ?? token
      if (token.kind !== 'player' && regionOf(placed(token, at)) !== 'visible') continue
      tokens.push(playerToken(token, at, token.id === activeTokenId))
    }
  }

  const fog: PlayerFog | null = fogOn
    ? {
        visible: circles.map((c) => ({ x: c.x, y: c.y, r: c.r })),
        explored: scene.fog.exploredEnabled === true ? playerFogMask(explored) : null,
        manual: playerFogEdits(scene),
      }
    : null

  return {
    sceneId: scene.id,
    grid: playerGrid(scene.grid),
    map,
    props,
    tokens,
    fog,
    templates: playerTemplates(scene, ui),
    ruler: playerRuler(campaign.settings, scene.grid, ui.measurement),
    initiative: playerInitiative(scene, new Set(tokens.map((token) => token.id))),
    view: playerView(campaign, scene, ui, memory, explored, circles),
    lockedCellPx: positiveOrNull(prefs.lockedCellPx),
  }
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/**
 * The item's position during a drag (UiState.liveDrag), or null when it is not
 * being dragged. Malformed entries are ignored.
 */
function livePosition(ui: ProjectionUi, id: Id): Point | null {
  const drag = ui.liveDrag
  if (!drag || !Object.hasOwn(drag, id)) return null
  const p = drag[id]
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
  return { x: p.x, y: p.y }
}

function placed(item: Item, at: Point): Footprint {
  return { x: at.x, y: at.y, width: item.width, height: item.height, rotation: item.rotation }
}

function playerItem(item: Item, at: Point): PlayerItem {
  return {
    id: item.id,
    assetId: item.assetId,
    x: at.x,
    y: at.y,
    width: item.width,
    height: item.height,
    rotation: item.rotation,
    opacity: item.opacity,
  }
}

function playerToken(token: Token, at: Point, active: boolean): PlayerToken {
  return {
    id: token.id,
    assetId: token.assetId,
    x: at.x,
    y: at.y,
    width: token.width,
    height: token.height,
    rotation: token.rotation,
    opacity: token.opacity,
    color: token.color,
    label: token.showLabel === true && typeof token.label === 'string' ? token.label : null,
    badge: typeof token.badge === 'string' ? token.badge : null,
    hpFraction: hpFraction(token.hp),
    conditions: token.conditions.filter((c): c is string => typeof c === 'string'),
    active,
  }
}

/** current / max clamped to 0..1, only for a public HP bar; never the numbers. */
function hpFraction(hp: TokenHp | null): number | null {
  if (!hp || hp.publicBar !== true || !(hp.max > 0)) return null
  const fraction = hp.current / hp.max
  return Number.isNaN(fraction) ? null : Math.min(1, Math.max(0, fraction))
}

function playerGrid(grid: Grid): PlayerGrid {
  return {
    size: grid.size,
    offsetX: grid.offsetX,
    offsetY: grid.offsetY,
    feetPerCell: grid.feetPerCell,
    visible: grid.visible,
    color: grid.color,
    opacity: grid.opacity,
  }
}

// ---------------------------------------------------------------------------
// Fog
// ---------------------------------------------------------------------------

const CHUNK_KEY = /^-?\d+,-?\d+$/

/** A fresh copy of the explored mask; only `x,y` chunk keys with string data. */
function playerFogMask(mask: FogMask): PlayerFogMask {
  const chunks: Record<string, string> = {}
  for (const key of Object.keys(mask.chunks)) {
    const data = mask.chunks[key]
    if (CHUNK_KEY.test(key) && typeof data === 'string') chunks[key] = data
  }
  return { cellPx: mask.cellPx, chunks }
}

function playerFogEdits(scene: Scene): PlayerFog['manual'] {
  const edits: PlayerFog['manual'] = []
  for (const edit of scene.fog.manual) {
    const shape = fogShape(edit.shape)
    if (shape) edits.push({ mode: edit.mode === 'reveal' ? 'reveal' : 'hide', shape })
  }
  return edits
}

function numbers(values: readonly number[]): number[] {
  return values.filter((v): v is number => typeof v === 'number')
}

/** FogShape rebuilt per variant; null for an unknown type (which also covers nothing). */
function fogShape(shape: FogShape): FogShape | null {
  switch (shape.type) {
    case 'rect':
      return { type: 'rect', x: shape.x, y: shape.y, width: shape.width, height: shape.height }
    case 'polygon':
      return { type: 'polygon', points: numbers(shape.points) }
    case 'brush':
      return { type: 'brush', points: numbers(shape.points), radius: shape.radius }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Templates, ruler, initiative
// ---------------------------------------------------------------------------

/** Pinned templates visible to players, then the temporary one being placed. */
function playerTemplates(scene: Scene, ui: ProjectionUi): PlayerTemplate[] {
  const temp = ui.tempTemplate
  // The template being placed, unless it was just pinned (same id): never twice.
  const all =
    temp && !scene.templates.some((t) => t.id === temp.id)
      ? [...scene.templates, temp]
      : scene.templates
  const shown: PlayerTemplate[] = []
  for (const t of all) {
    if (t.visibleToPlayers !== true) continue
    // A template being dragged is shown where it is now, like a player token.
    const at = livePosition(ui, t.id) ?? { x: t.originX, y: t.originY }
    shown.push({
      id: t.id,
      shape: t.shape,
      originX: at.x,
      originY: at.y,
      sizeFt: t.sizeFt,
      widthFt: t.widthFt,
      directionDeg: t.directionDeg,
      color: t.color,
    })
  }
  return shown
}

/** The live measurement, with its length precomputed (players never get the diagonal rule). */
function playerRuler(
  settings: Settings,
  grid: Grid,
  measurement: Measurement | null,
): PlayerRuler | null {
  if (settings.shareRuler !== true || !measurement || measurement.points.length < 2) return null
  const points = measurement.points.map((p) => ({ x: p.x, y: p.y }))
  // The same measurement as the DM's ruler (geometry/ruler), so both windows agree.
  const { cells, feet } = rulerLength(points, grid, settings.diagonalRule)
  return { points, feet, cells, units: settings.units }
}

function linkedToken(scene: Scene, entry: InitiativeEntry): Token | null {
  if (entry.tokenId === null) return null
  return scene.layers.tokens.find((t) => t.id === entry.tokenId) ?? null
}

/**
 * The entry players see as the current turn. The active entry, when players may
 * see it; during a hidden entry's turn, the last shown entry before it in turn
 * order (from round 2 on, wrapping to the end of the previous round), so a gap
 * in the highlight never tells players that a hidden creature is acting. Null
 * before combat, while the tracker is not shown, or when nothing shown came first.
 */
function shownTurn(scene: Scene): InitiativeEntry | null {
  const tracker = scene.initiative
  if (tracker.visibleToPlayers !== true || tracker.activeEntryId === null) return null
  const sorted = sortInitiative(tracker.entries)
  const index = sorted.findIndex((entry) => entry.id === tracker.activeEntryId)
  if (index < 0) return null
  const steps = tracker.round > 1 ? sorted.length : index + 1
  for (let k = 0; k < steps; k++) {
    const entry = sorted[(index - k + sorted.length) % sorted.length]
    if (entry && effectiveVisibility(entry, scene) === 'shown') return entry
  }
  return null
}

/**
 * Names only, in turn order; hidden entries are omitted without placeholders. A
 * public HP fraction is sent only for a token players get on the map right now
 * (`sentTokens`): an entry shown by name never reveals the health of a creature
 * that is hidden, fogged or gone (Decision 67).
 */
function playerInitiative(scene: Scene, sentTokens: ReadonlySet<Id>): PlayerInitiative | null {
  const tracker = scene.initiative
  if (tracker.visibleToPlayers !== true) return null
  const turn = shownTurn(scene)
  const entries: PlayerInitiative['entries'] = []
  for (const entry of sortInitiative(tracker.entries)) {
    if (effectiveVisibility(entry, scene) !== 'shown') continue
    const token =
      entry.tokenId !== null && sentTokens.has(entry.tokenId) ? linkedToken(scene, entry) : null
    entries.push({
      id: entry.id,
      name: entry.name,
      active: entry.id === turn?.id,
      hpFraction: hpFraction(token?.hp ?? null),
    })
  }
  return { round: tracker.round, entries }
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function usableRect(r: Rect | null | undefined): r is Rect {
  return (
    !!r &&
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height) &&
    r.width > 0 &&
    r.height > 0
  )
}

function viewRect(r: Rect): ViewRect {
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

function circleBounds(c: VisionCircle): Rect {
  return { x: c.x - c.r, y: c.y - c.r, width: 2 * c.r, height: 2 * c.r }
}

/**
 * Where the player view looks (SPEC §5.9, Decision 22). 'follow' mirrors the DM
 * camera; 'pushed' is the last pushed view; 'fit-explored' frames explored ∪
 * visible areas (vision circles and manual reveals). Each falls back to the
 * default view (see defaultView).
 */
function playerView(
  campaign: CampaignState,
  scene: Scene,
  ui: ProjectionUi,
  memory: SceneMemory | undefined,
  explored: FogMask,
  circles: readonly VisionCircle[],
): ViewRect {
  const mode = campaign.presentation.cameraMode
  if (mode === 'follow' && ui.dmViewport.width > 0 && ui.dmViewport.height > 0) {
    const followed = visibleRect(ui.dmCamera, ui.dmViewport)
    if (usableRect(followed)) return viewRect(followed)
  }
  if (mode === 'fit-explored') {
    const fitted =
      scene.fog.enabled !== false && scene.fog.exploredEnabled === true
        ? unionRects([
            ...[exploredBounds(explored)].filter((r): r is Rect => r !== null),
            ...circles.map(circleBounds),
            ...scene.fog.manual
              .filter((edit) => edit.mode === 'reveal')
              .map((edit) => shapeBounds(edit.shape))
              .filter((r): r is Rect => r !== null),
          ])
        : null
    return usableRect(fitted) ? viewRect(fitted) : defaultView(scene)
  }
  // 'pushed', and 'follow' without a usable DM viewport.
  const pushed = memory?.playerView
  return usableRect(pushed) ? viewRect(pushed) : defaultView(scene)
}

/**
 * The view before the DM pushes one: the committed map layer (visible, not
 * hidden), else 24 x 18 cells at the grid origin. It never depends on tokens,
 * props or drags, so the players' camera stays put while the DM works.
 */
function defaultView(scene: Scene): ViewRect {
  const { grid } = scene
  const maps =
    scene.layerState.map.visible === true
      ? scene.layers.map.filter((item) => item.hidden === false)
      : []
  const mapBounds = unionRects(maps.map(itemBounds))
  if (usableRect(mapBounds)) return viewRect(mapBounds)
  return {
    x: grid.offsetX,
    y: grid.offsetY,
    width: DEFAULT_VIEW_CELLS.width * grid.size,
    height: DEFAULT_VIEW_CELLS.height * grid.size,
  }
}

function positiveOrNull(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}
