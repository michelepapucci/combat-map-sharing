/**
 * The campaign data model. Refines the starting model in docs/SPEC.md §4; every
 * deviation is listed under "Decisions" in CLAUDE.md.
 *
 * Conventions
 * - Plain JSON only (no classes, Maps, typed arrays or Dates), so the state can be
 *   structured-cloned, diffed with Immer patches, stored in IndexedDB and
 *   serialized to a gist without adapters. Timestamps are epoch milliseconds.
 * - Persisted data has no optional keys: absent values are `null`.
 * - World coordinates are "world px": pixels of a map image drawn at scale 1.
 *   Items are anchored at their CENTER; `rotation` is degrees clockwise about the
 *   center; `width`/`height` are the unrotated size in world px.
 * - Array order is z-order (last = top) within a layer, and display order for scenes.
 * - Persisted: everything reachable from CampaignState (IndexedDB autosave, gist,
 *   zip backup). Changing its shape requires a schema change (CLAUDE.md, "Schema changes").
 * - Undo history records changes to `scenes` (scene list, scene content incl. fog
 *   toggles, manual fog edits, initiative and turn changes, pinned templates) and
 *   `name`. It never records `sceneMemory`, `presentation`, `settings`, `library`
 *   or `updatedAt`; those live outside `scenes` so undoing a scene-list change
 *   (Immer records splices as whole-element replaces) cannot roll them back.
 * - Transient (never persisted, never undoable): UiState and Ping.
 * - PlayerViewState is the ONLY campaign-derived data the player window receives.
 *   It is built by projectForPlayers() from whitelisted fields, as object literals;
 *   see "Projection rule" in CLAUDE.md. Player types never reuse campaign types.
 */

export type Id = string

// ---------------------------------------------------------------------------
// Enumerations (const arrays double as runtime lists for UI pickers and tests)
// ---------------------------------------------------------------------------

export const TOKEN_KINDS = ['player', 'npc', 'enemy'] as const
export type TokenKind = (typeof TOKEN_KINDS)[number]

export const SIZE_CATEGORIES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const
export type SizeCategory = (typeof SIZE_CATEGORIES)[number]

/**
 * Footprint edge in grid cells per size category (SPEC §5.1). A token's
 * width/height always equal FOOTPRINT_CELLS[sizeCategory] x grid.size; they are
 * rewritten when the size category or the grid size changes.
 */
export const FOOTPRINT_CELLS: Readonly<Record<SizeCategory, number>> = {
  tiny: 1,
  small: 1,
  medium: 1,
  large: 2,
  huge: 3,
  gargantuan: 4,
}

export const LAYER_NAMES = ['map', 'props', 'tokens'] as const
export type LayerName = (typeof LAYER_NAMES)[number]

export const ASSET_KINDS = ['token', 'prop', 'map'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

/** SPEC §5.4. 'five' = every square 5 ft (5e default); 'alternating' = 5/10 ft (DMG variant). */
export const DIAGONAL_RULES = ['five', 'alternating', 'euclidean'] as const
export type DiagonalRule = (typeof DIAGONAL_RULES)[number]

/**
 * How lengths are shown and typed. Rule values are always stored in feet (5e is
 * written in feet); metric shows them at the game convention 5 ft = 1.5 m.
 */
export const UNIT_SYSTEMS = ['metric', 'imperial'] as const
export type UnitSystem = (typeof UNIT_SYSTEMS)[number]

/** SPEC §5.5. 'center' = a square counts if its center is inside (default); 'half' = if >= 50% covered. */
export const AOE_COVERAGE_RULES = ['center', 'half'] as const
export type AoeCoverageRule = (typeof AOE_COVERAGE_RULES)[number]

export const AOE_SHAPES = ['circle', 'cone', 'line', 'cube', 'cylinder'] as const
export type AoeShape = (typeof AOE_SHAPES)[number]

/** SPEC §5.9. 'pushed' is the default. */
export const PLAYER_CAMERA_MODES = ['follow', 'pushed', 'fit-explored'] as const
export type PlayerCameraMode = (typeof PLAYER_CAMERA_MODES)[number]

export const STANDARD_CONDITIONS = [
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
] as const

// ---------------------------------------------------------------------------
// Persisted campaign
// ---------------------------------------------------------------------------

export interface CampaignState {
  /** Schema version; see migrations.ts. */
  version: number
  id: Id
  name: string
  /** Display order = array order. Never empty. Undoable. */
  scenes: Scene[]
  activeSceneId: Id
  /**
   * Per-scene state that must survive undo, keyed by scene id. Created with its
   * scene and never undoable. Deleting a scene keeps its memory, so undoing the
   * delete brings the scene back with its explored fog; validateCampaign drops
   * memory of scenes that no longer exist when a campaign is loaded.
   */
  sceneMemory: Record<Id, SceneMemory>
  /** Uploaded assets only. Built-in assets live in a code registry (ids prefixed `builtin:`). */
  library: AssetMeta[]
  settings: Settings
  presentation: Presentation
  createdAt: number
  /** Set outside recorded actions, so undo never moves it backwards. */
  updatedAt: number
}

export interface Settings {
  /** Units shown for distances, vision, templates (v2). Stored values stay in feet. */
  units: UnitSystem
  diagonalRule: DiagonalRule
  aoeCoverage: AoeCoverageRule
  /** Global magnetic-snap toggle (Alt still disables it per gesture). */
  snapEnabled: boolean
  /** Send the live ruler measurement to the player window. */
  shareRuler: boolean
  /** NPC tokens with visionFt > 0 also reveal fog (allies). Player tokens always do. */
  npcVision: boolean
}

/**
 * What the player window shows. Live controls, not undoable. The player zoom
 * lock ("1 cell = N px") depends on the physical display, so it is a device
 * preference (localStorage `vtt:lockedCellPx`), not campaign state.
 */
export interface Presentation {
  cameraMode: PlayerCameraMode
  /** Player window shows black (or the splash image) and receives no scene data. */
  blackout: boolean
  splashAssetId: Id | null
}

/** The DM window's camera: the world point at the viewport center plus a zoom. */
export interface Camera {
  x: number
  y: number
  /** Screen px per world px. */
  zoom: number
}

/**
 * A framed area of the world (top-left corner and size, world px). Views shared
 * with the player window are rectangles, not cameras, so they show the same area
 * on screens of any size: the player fits ("contains") the rectangle to its viewport.
 */
export interface ViewRect {
  x: number
  y: number
  width: number
  height: number
}

export interface Scene {
  id: Id
  name: string
  grid: Grid
  layers: SceneLayers
  /** Per-layer flags. `visible: false` hides the layer in both windows (and the projection). */
  layerState: Record<LayerName, LayerState>
  fog: SceneFog
  initiative: Initiative
  /** Pinned area templates only; temporary ones live in UiState. */
  templates: AoeTemplate[]
}

/** Per-scene state outside undo history (see CampaignState.sceneMemory). */
export interface SceneMemory {
  /** Explored fog memory. Players have seen it, so undo never takes it back. */
  explored: FogMask
  /** The last view the DM pushed to players (camera mode 'pushed'); null = never pushed. */
  playerView: ViewRect | null
}

export interface Grid {
  type: 'square'
  /** Cell edge in world px. */
  size: number
  /** World position of a grid line intersection, normalized to [0, size). */
  offsetX: number
  offsetY: number
  feetPerCell: number
  visible: boolean
  /** CSS color. */
  color: string
  /** 0..1 */
  opacity: number
}

export interface SceneLayers {
  map: Item[]
  props: Item[]
  tokens: Token[]
}

export interface LayerState {
  locked: boolean
  visible: boolean
}

export interface Item {
  id: Id
  /** Uploaded asset id, or a built-in id prefixed `builtin:`. */
  assetId: Id
  /** DM-facing name. Never sent to the player window. */
  name: string
  /** Center, world px. */
  x: number
  y: number
  /** Unrotated size, world px. */
  width: number
  height: number
  /** Degrees clockwise about the center. */
  rotation: number
  locked: boolean
  /** Never sent to the player window, on any layer. */
  hidden: boolean
  /** 0..1 */
  opacity: number
}

export interface Token extends Item {
  kind: TokenKind
  sizeCategory: SizeCategory
  /**
   * Vision radius in feet. A token is a vision source only if it is not hidden,
   * its layer is visible, visionFt > 0, and it is a player (or an NPC when
   * settings.npcVision).
   */
  visionFt: number | null
  /** Player-facing text shown under the token when showLabel. */
  label: string | null
  showLabel: boolean
  /** 1-3 characters drawn on the token itself (built-in "initials" tokens). Visible to players. */
  badge: string | null
  hp: TokenHp | null
  /** Standard 5e conditions (STANDARD_CONDITIONS) and free-form custom ones. */
  conditions: string[]
  /** Ring color (CSS). */
  color: string
  /** DM-only. Never sent to the player window. Not secret from anyone who can read the gist. */
  dmNotes: string
  /** Added to d20 when rolling initiative for this token. */
  initiativeModifier: number | null
}

export interface TokenHp {
  current: number
  max: number
  /** Players see an HP bar (a fraction, never the numbers). */
  publicBar: boolean
}

// --- Fog (SPEC §5.6) -------------------------------------------------------

export interface SceneFog {
  enabled: boolean
  /** Remember explored areas (dimmed for players). The memory itself is in SceneMemory. */
  exploredEnabled: boolean
  /** Applied in order on top of automatic fog. Undoable. */
  manual: FogEdit[]
}

/**
 * Explored memory as a sparse, chunked bitmap on an unbounded canvas.
 * Mask cell (i, j) covers world [i * cellPx, (i + 1) * cellPx) on each axis.
 * Chunks are FOG_CHUNK x FOG_CHUNK cells, keyed `${chunkX},${chunkY}`, stored as
 * base64 of a row-major bitset (bit k of byte b is cell 8b + k, LSB first).
 * Encoders drop trailing zero bytes and delete all-zero chunks; decoders
 * zero-pad to FOG_CHUNK_BYTES and reject longer input. Missing chunk = unexplored.
 */
export interface FogMask {
  /** World px per mask cell: grid.size / 4 when the mask was (re)created. */
  cellPx: number
  chunks: Record<string, string>
}

export const FOG_CHUNK = 64
export const FOG_CHUNK_BYTES = (FOG_CHUNK * FOG_CHUNK) / 8

export type FogEditMode = 'reveal' | 'hide'

/** Pure geometry (shared with the player types): never add DM-only fields here. */
export type FogShape =
  | { type: 'rect'; x: number; y: number; width: number; height: number }
  /** Flat [x0, y0, x1, y1, ...] in world px. */
  | { type: 'polygon'; points: number[] }
  /** Stroke of a round brush along flat points. */
  | { type: 'brush'; points: number[]; radius: number }

export interface FogEdit {
  id: Id
  /** 'reveal' makes the area fully visible (tokens included); 'hide' makes it black. */
  mode: FogEditMode
  shape: FogShape
}

// --- Initiative (SPEC §5.8) ---------------------------------------------------

/**
 * 'auto' follows the linked token: hidden while the token is missing, hidden, or
 * on a hidden layer (SPEC §5.7). 'hidden' and 'shown' are explicit DM overrides.
 */
export type InitiativeVisibility = 'auto' | 'hidden' | 'shown'

export interface InitiativeEntry {
  id: Id
  tokenId: Id | null
  /**
   * Player-facing name (shown in the player tracker). When added from a token it
   * copies the token's label if showLabel, otherwise its name; the DM can edit it.
   */
  name: string
  value: number
  dexTiebreak: number | null
  /** Manual tiebreak from drag-and-drop; lower sorts first among exact ties. */
  manualOrder: number
  visibility: InitiativeVisibility
}

export interface Initiative {
  /** Stored unsorted; display order = sortInitiative(entries). */
  entries: InitiativeEntry[]
  /** Replaces the spec's currentIndex so edits and re-sorts cannot shift the turn. */
  activeEntryId: Id | null
  round: number
  /** Global "Show tracker to players". */
  visibleToPlayers: boolean
}

// --- Area-of-effect templates (SPEC §5.5) --------------------------------------

export interface AoeTemplate {
  id: Id
  shape: AoeShape
  /** Origin in world px (cone/line apex, circle/cylinder center, cube corner/side midpoint). */
  originX: number
  originY: number
  /** Radius (circle, cylinder), length (cone, line) or side (cube), in feet; multiple of 5. */
  sizeFt: number
  /** Line width in feet (default 5); ignored for other shapes. */
  widthFt: number
  /** Direction in degrees clockwise from +x (cone, line, cube). */
  directionDeg: number
  /** CSS color. */
  color: string
  visibleToPlayers: boolean
}

// --- Asset library (SPEC §5.2) --------------------------------------------------

export interface AssetMeta {
  /** Random id; the blob is stored in IndexedDB under the same id. */
  id: Id
  kind: AssetKind
  /** DM-facing. Never sent to the player window. */
  name: string
  tags: string[]
  /** image/png | image/jpeg | image/webp */
  mime: string
  /**
   * Natural size of the stored image, px. The stored blob is final: downscaling
   * (> 8192 px) and re-encoding for gist size limits happen at import, so
   * mime/bytes/hash always describe exactly what is stored and synced.
   */
  width: number
  height: number
  bytes: number
  /** SHA-256 hex of the stored blob; used for gist asset diffing. */
  hash: string
  /** Tokens: default size category when placed. */
  defaultSize: SizeCategory | null
  /** Tokens: default kind when placed (uploads default to 'enemy', which never reveals fog). */
  defaultKind: TokenKind | null
  /** Props: default footprint in cells when placed. */
  defaultCells: { w: number; h: number } | null
  /** Too large to sync to a gist even after re-encoding; it stays on this device only. */
  localOnly: boolean
  createdAt: number
}

// ---------------------------------------------------------------------------
// Transient DM window state (never persisted)
// ---------------------------------------------------------------------------

export const TOOLS = ['select', 'measure', 'aoe', 'fog', 'ping', 'calibrate'] as const
export type Tool = (typeof TOOLS)[number]

/** A ping in the DM window. The sync message carries only id, x, y; the player times it on receipt. */
export interface Ping {
  id: Id
  x: number
  y: number
  /** performance.now() in the DM window. DM-local: never sent. */
  createdAt: number
}

/** A ruler: fixed waypoints plus the live end point, world px. */
export interface Measurement {
  points: { x: number; y: number }[]
}

export interface UiState {
  tool: Tool
  selection: Id[]
  /** DM window camera. */
  dmCamera: Camera
  /** DM canvas size in screen px (with dmCamera it gives the rectangle sent in 'follow' mode). */
  dmViewport: { width: number; height: number }
  measurement: Measurement | null
  /** Unpinned template being placed; discarded when the tool changes. */
  tempTemplate: AoeTemplate | null
  /** Render the DM canvas through projectForPlayers (SPEC §5.6 "Preview as players"). */
  previewAsPlayers: boolean
  /**
   * Item positions while a drag is in progress (committed to the campaign on drop).
   * Player tokens are shown at their live position; enemy/NPC tokens only while the
   * live position is itself visible (see "Projection rule"). Fog vision always uses
   * committed positions.
   */
  liveDrag: Record<Id, { x: number; y: number }> | null
}

// ---------------------------------------------------------------------------
// Player projection: the only campaign-derived data the player window receives.
// Dedicated types (never campaign types), built as object literals.
// ---------------------------------------------------------------------------

export interface PlayerGrid {
  size: number
  offsetX: number
  offsetY: number
  visible: boolean
  color: string
  opacity: number
}

export interface PlayerItem {
  id: Id
  assetId: Id
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
}

export interface PlayerToken extends PlayerItem {
  /** Ring color. There is deliberately no `kind`: npc vs enemy is a spoiler. */
  color: string
  /** Set only when the DM enabled the label. */
  label: string | null
  badge: string | null
  /** current / max clamped to 0..1, only when the HP bar is public. */
  hpFraction: number | null
  conditions: string[]
  /** Pulsing ring: its initiative turn is active AND the tracker and that entry are visible to players. */
  active: boolean
}

export interface PlayerFogMask {
  cellPx: number
  chunks: Record<string, string>
}

export interface PlayerFogEdit {
  mode: FogEditMode
  shape: FogShape
}

export interface PlayerFog {
  /** Union of these circles (world px) is currently visible. Only non-hidden sources. */
  visible: { x: number; y: number; r: number }[]
  /** Explored memory, or null when explored memory is off. */
  explored: PlayerFogMask | null
  manual: PlayerFogEdit[]
}

export interface PlayerTemplate {
  id: Id
  shape: AoeShape
  originX: number
  originY: number
  sizeFt: number
  widthFt: number
  directionDeg: number
  color: string
}

/** Computed in the DM window, so the player never needs the diagonal rule. */
export interface PlayerRuler {
  points: { x: number; y: number }[]
  feet: number
  cells: number
}

export interface PlayerInitiative {
  round: number
  entries: { id: Id; name: string; active: boolean; hpFraction: number | null }[]
}

export interface PlayerViewScene {
  /** Opaque per-scene id so the player can reset fades on scene switch. Scene names are not sent. */
  sceneId: Id
  grid: PlayerGrid
  map: PlayerItem[]
  props: PlayerItem[]
  tokens: PlayerToken[]
  /** null when fog is disabled for the scene. */
  fog: PlayerFog | null
  templates: PlayerTemplate[]
  ruler: PlayerRuler | null
  initiative: PlayerInitiative | null
  /** World area to fit in the player viewport (pushed, followed or fitted, resolved by the DM). */
  view: ViewRect
  /** Fixed scale "1 cell = N px" (device preference of the DM machine), or null. */
  lockedCellPx: number | null
}

/** During blackout no scene data is sent at all. */
export type PlayerViewState =
  { blackout: true; splashAssetId: Id | null } | { blackout: false; scene: PlayerViewScene }
