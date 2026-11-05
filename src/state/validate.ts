/**
 * The campaign validator: the gate every campaign document passes on every load
 * (IndexedDB), import (zip/JSON backup) and gist pull, right after
 * migrateToCurrent and before anything uses or saves it.
 *
 * Why it is strict: a document may come from a corrupted save or from a gist or
 * zip someone else wrote. Parts of it reach the DOM (colors go into style
 * attributes and Konva fills), the player window, and the gist API, so the
 * validator accepts only the exact shape of CampaignState with sane values.
 *
 * Rebuild, never spread. Every object in the result is a NEW object literal
 * written field by field, and every array a new array; input objects and arrays
 * are never returned, spread or passed through. That gives four guarantees:
 * - unknown keys (a field from a hostile file, a typo, a stale experiment) are
 *   dropped, because only fields named here are copied;
 * - `__proto__`, `constructor` and friends can never be assigned: plain objects
 *   are written only with the fixed keys below, and the two string-keyed records
 *   (`sceneMemory`, fog `chunks`) only with keys that passed a check (scene ids,
 *   which may not name an Object.prototype property, and `x,y` chunk keys);
 * - the result shares no references with the input, so later mutation of either
 *   cannot affect the other (Immer freezes the campaign; the input may be reused);
 * - TypeScript checks every literal against CampaignState, so a field added to
 *   the model without a matching line here fails to compile.
 * Fields are read only if they are OWN properties of the input object.
 *
 * Errors: wrong types and out-of-range values throw CampaignValidationError with
 * the path of the offending value. Repairs: a few problems that the app itself
 * could plausibly leave behind (unnormalized offsets and rotations, stale token
 * sizes, dangling references, missing or orphaned scene memory, empty fog chunks)
 * are fixed and described in `repairs`, one human-readable line per fix.
 *
 * Pure module: no React, no DOM.
 */
import { MAX_GRID_SIZE, MIN_GRID_SIZE, mod } from '../geometry/grid'
import { createSceneMemory } from './defaults'
import { CURRENT_SCHEMA_VERSION, isJsonObject, type JsonObject } from './migrations'
import {
  AOE_COVERAGE_RULES,
  AOE_SHAPES,
  ASSET_KINDS,
  DIAGONAL_RULES,
  FOG_CHUNK_BYTES,
  FOOTPRINT_CELLS,
  LAYER_NAMES,
  PLAYER_CAMERA_MODES,
  SIZE_CATEGORIES,
  TOKEN_KINDS,
  UNIT_SYSTEMS,
  type AoeTemplate,
  type AssetMeta,
  type CampaignState,
  type FogEdit,
  type FogEditMode,
  type FogMask,
  type FogShape,
  type Grid,
  type Id,
  type Initiative,
  type InitiativeEntry,
  type InitiativeVisibility,
  type Item,
  type LayerName,
  type LayerState,
  type Presentation,
  type Scene,
  type SceneFog,
  type SceneLayers,
  type SceneMemory,
  type Settings,
  type Token,
  type TokenHp,
  type ViewRect,
} from './types'

// ---------------------------------------------------------------------------
// Limits (exported so editing UIs can enforce the same caps)
// ---------------------------------------------------------------------------

/** String caps in UTF-16 code units. Generous: they only stop absurd or hostile data. */
export const MAX_ID_LENGTH = 128
export const MAX_NAME_LENGTH = 200
export const MAX_NOTES_LENGTH = 20_000
/** Asset tags and token conditions, each. */
export const MAX_TAG_LENGTH = 64
/** Token badges are 1 to MAX_BADGE_CHARS characters (code points). */
export const MAX_BADGE_CHARS = 3
/** Largest stored image edge, px (uploads are downscaled to 8192 at import). */
export const MAX_IMAGE_PX = 16_384
/** Largest default prop footprint edge, cells. */
export const MAX_DEFAULT_CELLS = 100

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const
const FOG_EDIT_MODES = ['reveal', 'hide'] as const satisfies readonly FogEditMode[]
const FOG_SHAPE_TYPES = ['rect', 'polygon', 'brush'] as const satisfies readonly FogShape['type'][]
const INITIATIVE_VISIBILITIES = [
  'auto',
  'hidden',
  'shown',
] as const satisfies readonly InitiativeVisibility[]

/** Hex colors only: anything else (names, rgb(), url(...)) could smuggle CSS into style attributes. */
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const SHA256_HEX = /^[0-9a-f]{64}$/
/** `${chunkX},${chunkY}` as the encoder writes it: canonical integers (no leading zeros, no "-0"). */
const CHUNK_KEY = /^(?:0|-?[1-9]\d{0,5}),(?:0|-?[1-9]\d{0,5})$/
/** Canonical padded base64. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const BUILTIN_PREFIX = 'builtin:'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Thrown when a campaign document cannot be used; `path` locates the bad value. */
export class CampaignValidationError extends Error {
  override name = 'CampaignValidationError'
  /** For example `scenes[0].layers.tokens[2].hp.max`; '' means the document itself. */
  readonly path: string

  constructor(path: string, problem: string) {
    super(`Invalid campaign data at ${path === '' ? 'the top level' : path}: ${problem}`)
    this.path = path
  }
}

export interface ValidatedCampaign {
  /** A fresh copy, sharing no objects or arrays with the input. */
  campaign: CampaignState
  /** One line per repaired problem ("<path>: <what changed>"); empty for a clean document. */
  repairs: string[]
}

/**
 * Checks a migrated campaign document (run migrateToCurrent first) and rebuilds
 * it as a CampaignState. Throws CampaignValidationError for anything it cannot
 * safely repair; see the module comment for what it repairs.
 */
export function validateCampaign(doc: JsonObject): ValidatedCampaign {
  const ctx: Ctx = { repairs: [] }
  const field = fields(doc, '', ctx)

  const version = field('version', int)
  if (version !== CURRENT_SCHEMA_VERSION) {
    fail('version', `expected schema v${CURRENT_SCHEMA_VERSION} (run migrateToCurrent first)`)
  }

  const scenes = field('scenes', arr(parseScene))
  const [firstScene] = scenes
  if (!firstScene) fail('scenes', 'expected at least one scene')
  const sceneIds = new Set<Id>()
  scenes.forEach((scene, i) => unique(sceneIds, scene.id, `scenes[${i}].id`))

  let activeSceneId = field('activeSceneId', id)
  if (!sceneIds.has(activeSceneId)) {
    repair(ctx, 'activeSceneId', `unknown scene "${activeSceneId}", set to the first scene`)
    activeSceneId = firstScene.id
  }

  const library = field('library', arr(parseAssetMeta))
  const assetIds = new Set<Id>()
  library.forEach((asset, i) => unique(assetIds, asset.id, `library[${i}].id`))

  const campaign: CampaignState = {
    version,
    id: field('id', id),
    name: field('name', text(MAX_NAME_LENGTH)),
    scenes,
    activeSceneId,
    sceneMemory: field('sceneMemory', (value, path) =>
      parseSceneMemoryRecord(value, path, ctx, scenes),
    ),
    library,
    settings: field('settings', parseSettings),
    presentation: field('presentation', (value, path) =>
      parsePresentation(value, path, ctx, assetIds),
    ),
    createdAt: field('createdAt', num),
    updatedAt: field('updatedAt', num),
  }
  return { campaign, repairs: ctx.repairs }
}

// ---------------------------------------------------------------------------
// Parser toolkit. A Parser checks one JSON value found at `path` and returns a
// fresh, typed copy; composite parsers build object literals from `fields`.
// ---------------------------------------------------------------------------

interface Ctx {
  repairs: string[]
}

type Parser<T> = (value: unknown, path: string, ctx: Ctx) => T

/** Reads one own field of an object and validates it at `<path>.<key>`. */
type FieldReader = <T>(key: string, parse: Parser<T>) => T

function fail(path: string, problem: string): never {
  throw new CampaignValidationError(path, problem)
}

function repair(ctx: Ctx, path: string, change: string): void {
  ctx.repairs.push(`${path}: ${change}`)
}

/** A short description of a bad value for error messages (never echoes long strings). */
function describe(value: unknown): string {
  if (value === undefined) return 'nothing'
  if (value === null) return 'null'
  if (Array.isArray(value)) return `an array of ${value.length}`
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') {
    return value.length > 40 ? `a string of ${value.length} characters` : JSON.stringify(value)
  }
  return `a value of type ${typeof value}`
}

function obj(value: unknown, path: string): JsonObject {
  if (!isJsonObject(value)) fail(path, `expected an object, got ${describe(value)}`)
  return value
}

function fields(value: unknown, path: string, ctx: Ctx): FieldReader {
  const o = obj(value, path)
  return (key, parse) =>
    parse(Object.hasOwn(o, key) ? o[key] : undefined, path === '' ? key : `${path}.${key}`, ctx)
}

/** Adds a condition to a parser's result. */
function check<T>(parse: Parser<T>, ok: (value: T) => boolean, expected: string): Parser<T> {
  return (value, path, ctx) => {
    const parsed = parse(value, path, ctx)
    if (!ok(parsed)) fail(path, `expected ${expected}, got ${describe(parsed)}`)
    return parsed
  }
}

/** Finite numbers only: NaN, ±Infinity and numeric strings are rejected. */
const num: Parser<number> = (value, path) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, `expected a finite number, got ${describe(value)}`)
  }
  return value
}

const int = check(num, Number.isInteger, 'an integer')
const positive = check(num, (n) => n > 0, 'a number > 0')
const nonNegative = check(num, (n) => n >= 0, 'a number >= 0')
const unit = check(num, (n) => n >= 0 && n <= 1, 'a number from 0 to 1')

function intRange(min: number, max: number): Parser<number> {
  return check(int, (n) => n >= min && n <= max, `an integer from ${min} to ${max}`)
}

const bool: Parser<boolean> = (value, path) => {
  if (typeof value !== 'boolean') fail(path, `expected true or false, got ${describe(value)}`)
  return value
}

/** Any string of at most `maxLength` UTF-16 code units (empty allowed). */
function str(maxLength: number): Parser<string> {
  return (value, path) => {
    if (typeof value !== 'string') fail(path, `expected a string, got ${describe(value)}`)
    if (value.length > maxLength) {
      fail(path, `expected at most ${maxLength} characters, got ${value.length}`)
    }
    return value
  }
}

/**
 * Free text (names, labels, notes, tags, conditions): a string, cut to
 * `maxLength` code units with a repair note when longer. Over-long text is never
 * a reason to refuse a campaign the app itself may have saved.
 */
function text(maxLength: number): Parser<string> {
  return (value, path, ctx) => {
    if (typeof value !== 'string') fail(path, `expected a string, got ${describe(value)}`)
    if (value.length <= maxLength) return value
    let cut = value.slice(0, maxLength)
    // Never split a surrogate pair.
    if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1)
    repair(ctx, path, `shortened from ${value.length} to ${cut.length} characters`)
    return cut
  }
}

function matching(pattern: RegExp, expected: string, maxLength: number): Parser<string> {
  return check(str(maxLength), (s) => pattern.test(s), expected)
}

/**
 * Ids: non-empty strings of at most MAX_ID_LENGTH. Names of Object.prototype
 * properties (`__proto__`, `constructor`, `toString`...) are refused, because
 * scene ids become keys of `sceneMemory` and lookups by id must never reach the
 * prototype. Real ids are UUIDs or `builtin:<kind>/<slug>`.
 */
const id: Parser<Id> = (value, path, ctx) => {
  const s = str(MAX_ID_LENGTH)(value, path, ctx)
  if (s === '') fail(path, 'expected a non-empty id')
  if (s in Object.prototype) fail(path, `"${s}" is a reserved name and cannot be an id`)
  return s
}

const color = matching(HEX_COLOR, 'a hex color such as #3b82f6', 9)

function oneOf<const T extends string>(values: readonly T[]): Parser<T> {
  const allowed: readonly string[] = values
  const isAllowed = (value: unknown): value is T =>
    typeof value === 'string' && allowed.includes(value)
  return (value, path) => {
    if (!isAllowed(value)) {
      fail(path, `expected one of ${values.join(', ')}; got ${describe(value)}`)
    }
    return value
  }
}

/** `null` or a valid value. A missing key is an error: persisted data has no optional keys. */
function nullable<T>(parse: Parser<T>): Parser<T | null> {
  return (value, path, ctx) => (value === null ? null : parse(value, path, ctx))
}

/** A new array of parsed elements (a hole or a missing element fails like `undefined`). */
function arr<T>(parse: Parser<T>): Parser<T[]> {
  return (value, path, ctx) => {
    if (!Array.isArray(value)) fail(path, `expected an array, got ${describe(value)}`)
    const out: T[] = []
    for (let i = 0; i < value.length; i++) {
      out.push(parse(value[i], `${path}[${i}]`, ctx))
    }
    return out
  }
}

/** Ids are unique within their scope (scene list, a scene's items, the library...). */
function unique(seen: Set<Id>, value: Id, path: string): void {
  if (seen.has(value)) fail(path, `duplicate id "${value}"`)
  seen.add(value)
}

/** Path of a record entry: `sceneMemory["scene-1"]`. */
function keyPath(path: string, key: string): string {
  return `${path}[${JSON.stringify(key.length > 140 ? `${key.slice(0, 140)}…` : key)}]`
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

const parseScene: Parser<Scene> = (value, path, ctx) => {
  const field = fields(value, path, ctx)
  const grid = field('grid', parseGrid)
  const layers = field('layers', (v, p) => parseLayers(v, p, ctx, grid))
  const fog = field('fog', parseSceneFog)
  const initiative = field('initiative', parseInitiative)
  const templates = field('templates', arr(parseTemplate))

  const itemIds = new Set<Id>()
  for (const layer of LAYER_NAMES) {
    const items: Item[] = layers[layer]
    items.forEach((item, i) => unique(itemIds, item.id, `${path}.layers.${layer}[${i}].id`))
  }
  const fogIds = new Set<Id>()
  fog.manual.forEach((edit, i) => unique(fogIds, edit.id, `${path}.fog.manual[${i}].id`))
  const entryIds = new Set<Id>()
  initiative.entries.forEach((entry, i) =>
    unique(entryIds, entry.id, `${path}.initiative.entries[${i}].id`),
  )
  const templateIds = new Set<Id>()
  templates.forEach((t, i) => unique(templateIds, t.id, `${path}.templates[${i}].id`))

  return {
    id: field('id', id),
    name: field('name', text(MAX_NAME_LENGTH)),
    grid,
    layers,
    layerState: field('layerState', parseLayerStates),
    fog,
    initiative,
    templates,
  }
}

const parseGrid: Parser<Grid> = (value, path, ctx) => {
  const field = fields(value, path, ctx)
  const size = field(
    'size',
    check(
      num,
      (n) => n >= MIN_GRID_SIZE && n <= MAX_GRID_SIZE,
      `a cell size from ${MIN_GRID_SIZE} to ${MAX_GRID_SIZE}`,
    ),
  )
  // Offsets are normalized to [0, size) everywhere in the app; fix older or hand-edited values.
  const offset = (key: 'offsetX' | 'offsetY'): number => {
    const raw = field(key, num)
    const normalized = mod(raw, size)
    if (normalized !== raw) repair(ctx, `${path}.${key}`, `${raw} normalized to ${normalized}`)
    return normalized
  }
  return {
    type: field('type', oneOf(['square'])),
    size,
    offsetX: offset('offsetX'),
    offsetY: offset('offsetY'),
    feetPerCell: field('feetPerCell', positive),
    visible: field('visible', bool),
    color: field('color', color),
    opacity: field('opacity', unit),
  }
}

function parseLayers(value: unknown, path: string, ctx: Ctx, grid: Grid): SceneLayers {
  const field = fields(value, path, ctx)
  return {
    map: field('map', arr(parseItem)),
    props: field('props', arr(parseItem)),
    tokens: field(
      'tokens',
      arr((v, p) => parseToken(v, p, ctx, grid)),
    ),
  }
}

const parseLayerState: Parser<LayerState> = (value, path, ctx) => {
  const field = fields(value, path, ctx)
  return { locked: field('locked', bool), visible: field('visible', bool) }
}

const parseLayerStates: Parser<Record<LayerName, LayerState>> = (value, path, ctx) => {
  const field = fields(value, path, ctx)
  return {
    map: field('map', parseLayerState),
    props: field('props', parseLayerState),
    tokens: field('tokens', parseLayerState),
  }
}

// --- Items and tokens -------------------------------------------------------

const parseItem: Parser<Item> = (value, path, ctx) => {
  const field = fields(value, path, ctx)
  const rotation = field('rotation', num)
  const normalized = mod(rotation, 360)
  if (normalized !== rotation)
    repair(ctx, `${path}.rotation`, `${rotation} normalized to ${normalized}`)
  return {
    id: field('id', id),
    // Any id: built-in ids are not checked against the registry, and a missing
    // upload renders as a placeholder instead of failing the whole campaign.
    assetId: field('assetId', id),
    name: field('name', text(MAX_NAME_LENGTH)),
    x: field('x', num),
    y: field('y', num),
    width: field('width', positive),
    height: field('height', positive),
    rotation: normalized,
    locked: field('locked', bool),
    hidden: field('hidden', bool),
    opacity: field('opacity', unit),
  }
}

const badge = check(
  str(MAX_NAME_LENGTH),
  (s) => {
    const chars = Array.from(s).length
    return chars >= 1 && chars <= MAX_BADGE_CHARS
  },
  `1 to ${MAX_BADGE_CHARS} characters`,
)

const parseHp: Parser<TokenHp> = (value, path, ctx) => {
  const field = fields(value, path, ctx)
  return {
    current: field('current', num),
    max: field('max', positive),
    publicBar: field('publicBar', bool),
  }
}

function parseToken(value: unknown, path: string, ctx: Ctx, grid: Grid): Token {
  // `item` is our own fresh copy of the Item fields, so spreading it is safe.
  const item = parseItem(value, path, ctx)
  const field = fields(value, path, ctx)
  const sizeCategory = field('sizeCategory', oneOf(SIZE_CATEGORIES))

  // Token size always follows the footprint and the grid; tokens are center-anchored,
  // so rewriting width/height keeps the center (x, y) where it is.
  const span = FOOTPRINT_CELLS[sizeCategory] * grid.size
  if (item.width !== span || item.height !== span) {
    repair(
      ctx,
      path,
      `size ${item.width}×${item.height} rewritten to ${span}×${span} ` +
        `(${sizeCategory} on a ${grid.size} px grid)`,
    )
  }

  const conditions = field('conditions', arr(text(MAX_TAG_LENGTH)))
  const distinct = Array.from(new Set(conditions))
  if (distinct.length !== conditions.length) {
    repair(ctx, `${path}.conditions`, 'removed duplicate conditions')
  }

  return {
    ...item,
    width: span,
    height: span,
    kind: field('kind', oneOf(TOKEN_KINDS)),
    sizeCategory,
    visionFt: field('visionFt', nullable(nonNegative)),
    label: field('label', nullable(text(MAX_NAME_LENGTH))),
    showLabel: field('showLabel', bool),
    badge: field('badge', nullable(badge)),
    hp: field('hp', nullable(parseHp)),
    conditions: distinct,
    color: field('color', color),
    dmNotes: field('dmNotes', text(MAX_NOTES_LENGTH)),
    initiativeModifier: field('initiativeModifier', nullable(int)),
  }
}

// --- Fog -------------------------------------------------------------------

/** Flat [x0, y0, x1, y1, ...]: an even count of at least `min` finite numbers. */
function points(min: number): Parser<number[]> {
  return check(
    arr(num),
    (p) => p.length % 2 === 0 && p.length >= min,
    `an even number (at least ${min}) of coordinates`,
  )
}

const parseFogShape: Parser<FogShape> = (value, path, ctx) => {
  const field = fields(value, path, ctx)
  const type = field('type', oneOf(FOG_SHAPE_TYPES))
  switch (type) {
    case 'rect':
      return {
        type,
        x: field('x', num),
        y: field('y', num),
        width: field('width', nonNegative),
        height: field('height', nonNegative),
      }
    case 'polygon':
      return { type, points: field('points', points(6)) }
    case 'brush':
      return { type, points: field('points', points(2)), radius: field('radius', positive) }
  }
}

const parseFogEdit: Parser<FogEdit> = (value, path, ctx) => {
  const field = fields(value, path, ctx)
  return {
    id: field('id', id),
    mode: field('mode', oneOf(FOG_EDIT_MODES)),
    shape: field('shape', parseFogShape),
  }
}

const parseSceneFog: Parser<SceneFog> = (value, path, ctx) => {
  const field = fields(value, path, ctx)
  return {
    enabled: field('enabled', bool),
    exploredEnabled: field('exploredEnabled', bool),
    manual: field('manual', arr(parseFogEdit)),
  }
}

/** Decoded size of a string that already matched BASE64. */
function base64Bytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return (data.length / 4) * 3 - padding
}

const parseFogMask: Parser<FogMask> = (value, path, ctx) => {
  const field = fields(value, path, ctx)
  const cellPx = field('cellPx', positive)
  const rawChunks = field('chunks', obj)
  // Only keys that match CHUNK_KEY are ever assigned, so `__proto__` cannot get in.
  const chunks: Record<string, string> = {}
  for (const key of Object.keys(rawChunks)) {
    const chunkPath = keyPath(`${path}.chunks`, key)
    if (!CHUNK_KEY.test(key)) fail(chunkPath, 'expected a chunk key such as "0,-2"')
    const data = rawChunks[key]
    if (typeof data !== 'string') fail(chunkPath, `expected a base64 string, got ${describe(data)}`)
    if (data === '') {
      repair(ctx, chunkPath, 'dropped an empty chunk')
      continue
    }
    if (!BASE64.test(data)) fail(chunkPath, 'expected canonical base64')
    const bytes = base64Bytes(data)
    if (bytes > FOG_CHUNK_BYTES) {
      fail(chunkPath, `expected at most ${FOG_CHUNK_BYTES} bytes, got ${bytes}`)
    }
    chunks[key] = data
  }
  return { cellPx, chunks }
}

const parseViewRect: Parser<ViewRect> = (value, path, ctx) => {
  const field = fields(value, path, ctx)
  return {
    x: field('x', num),
    y: field('y', num),
    width: field('width', positive),
    height: field('height', positive),
  }
}

const parseSceneMemory: Parser<SceneMemory> = (value, path, ctx) => {
  const field = fields(value, path, ctx)
  return {
    explored: field('explored', parseFogMask),
    playerView: field('playerView', nullable(parseViewRect)),
  }
}

/**
 * One memory per scene, keyed by scene id. A missing memory is recreated empty;
 * memory of a scene that no longer exists (kept after a delete so undo can bring
 * it back) is dropped at load. Only scene ids (never Object.prototype names, see
 * `id`) are assigned as keys.
 */
function parseSceneMemoryRecord(
  value: unknown,
  path: string,
  ctx: Ctx,
  scenes: readonly Scene[],
): Record<Id, SceneMemory> {
  const raw = obj(value, path)
  const memory: Record<Id, SceneMemory> = {}
  for (const scene of scenes) {
    const entryPath = keyPath(path, scene.id)
    if (Object.hasOwn(raw, scene.id)) {
      memory[scene.id] = parseSceneMemory(raw[scene.id], entryPath, ctx)
    } else {
      repair(ctx, entryPath, 'missing, recreated empty')
      memory[scene.id] = createSceneMemory(scene)
    }
  }
  const sceneIds = new Set(scenes.map((scene) => scene.id))
  for (const key of Object.keys(raw)) {
    if (!sceneIds.has(key)) repair(ctx, keyPath(path, key), 'dropped memory of a deleted scene')
  }
  return memory
}

// --- Initiative and templates ------------------------------------------------

const parseInitiativeEntry: Parser<InitiativeEntry> = (value, path, ctx) => {
  const field = fields(value, path, ctx)
  return {
    id: field('id', id),
    // A token id that matches no token is valid: the token was deleted, and
    // 'auto' visibility then hides the entry from players.
    tokenId: field('tokenId', nullable(id)),
    name: field('name', text(MAX_NAME_LENGTH)),
    value: field('value', num),
    dexTiebreak: field('dexTiebreak', nullable(num)),
    manualOrder: field('manualOrder', num),
    visibility: field('visibility', oneOf(INITIATIVE_VISIBILITIES)),
  }
}

const parseInitiative: Parser<Initiative> = (value, path, ctx) => {
  const field = fields(value, path, ctx)
  const entries = field('entries', arr(parseInitiativeEntry))
  let activeEntryId = field('activeEntryId', nullable(id))
  if (activeEntryId !== null && !entries.some((entry) => entry.id === activeEntryId)) {
    repair(ctx, `${path}.activeEntryId`, `unknown entry "${activeEntryId}", cleared`)
    activeEntryId = null
  }
  return {
    entries,
    activeEntryId,
    round: field(
      'round',
      check(int, (n) => n >= 1, 'an integer >= 1'),
    ),
    visibleToPlayers: field('visibleToPlayers', bool),
  }
}

const parseTemplate: Parser<AoeTemplate> = (value, path, ctx) => {
  const field = fields(value, path, ctx)
  return {
    id: field('id', id),
    shape: field('shape', oneOf(AOE_SHAPES)),
    originX: field('originX', num),
    originY: field('originY', num),
    sizeFt: field('sizeFt', nonNegative),
    widthFt: field('widthFt', positive),
    directionDeg: field('directionDeg', num),
    color: field('color', color),
    visibleToPlayers: field('visibleToPlayers', bool),
  }
}

// ---------------------------------------------------------------------------
// Library, settings, presentation
// ---------------------------------------------------------------------------

const parseDefaultCells: Parser<{ w: number; h: number }> = (value, path, ctx) => {
  const field = fields(value, path, ctx)
  return {
    w: field('w', intRange(1, MAX_DEFAULT_CELLS)),
    h: field('h', intRange(1, MAX_DEFAULT_CELLS)),
  }
}

const parseAssetMeta: Parser<AssetMeta> = (value, path, ctx) => {
  const field = fields(value, path, ctx)
  return {
    // Uploads only: a `builtin:` id would shadow the code registry.
    id: field(
      'id',
      check(
        id,
        (s) => !s.startsWith(BUILTIN_PREFIX),
        `an id without the "${BUILTIN_PREFIX}" prefix`,
      ),
    ),
    kind: field('kind', oneOf(ASSET_KINDS)),
    name: field('name', text(MAX_NAME_LENGTH)),
    tags: field('tags', arr(text(MAX_TAG_LENGTH))),
    mime: field('mime', oneOf(IMAGE_MIMES)),
    width: field('width', intRange(1, MAX_IMAGE_PX)),
    height: field('height', intRange(1, MAX_IMAGE_PX)),
    bytes: field(
      'bytes',
      check(int, (n) => n >= 0, 'an integer >= 0'),
    ),
    hash: field('hash', matching(SHA256_HEX, 'a lowercase SHA-256 hex digest', 64)),
    defaultSize: field('defaultSize', nullable(oneOf(SIZE_CATEGORIES))),
    defaultKind: field('defaultKind', nullable(oneOf(TOKEN_KINDS))),
    defaultCells: field('defaultCells', nullable(parseDefaultCells)),
    localOnly: field('localOnly', bool),
    createdAt: field('createdAt', num),
  }
}

const parseSettings: Parser<Settings> = (value, path, ctx) => {
  const field = fields(value, path, ctx)
  return {
    units: field('units', oneOf(UNIT_SYSTEMS)),
    diagonalRule: field('diagonalRule', oneOf(DIAGONAL_RULES)),
    aoeCoverage: field('aoeCoverage', oneOf(AOE_COVERAGE_RULES)),
    snapEnabled: field('snapEnabled', bool),
    shareRuler: field('shareRuler', bool),
    npcVision: field('npcVision', bool),
  }
}

function parsePresentation(
  value: unknown,
  path: string,
  ctx: Ctx,
  assetIds: ReadonlySet<Id>,
): Presentation {
  const field = fields(value, path, ctx)
  let splashAssetId = field('splashAssetId', nullable(id))
  if (splashAssetId !== null && !assetIds.has(splashAssetId)) {
    repair(ctx, `${path}.splashAssetId`, `unknown asset "${splashAssetId}", cleared`)
    splashAssetId = null
  }
  return {
    cameraMode: field('cameraMode', oneOf(PLAYER_CAMERA_MODES)),
    blackout: field('blackout', bool),
    splashAssetId,
  }
}
