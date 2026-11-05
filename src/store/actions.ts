import type { Draft } from 'immer'
import { badgeStyleFor, getTokenPreset, KIND_COLORS } from '../assets/builtin/registry'
import { findUpload, placeableImage } from '../assets/catalog'
import { calibrateFromBox, clampGridSize, mod, nearestLine } from '../geometry/grid'
import { itemBounds, rectCenter, unionRects } from '../geometry/rect'
import { snapCenter, tokenSpan } from '../geometry/snap'
import type { Point, Rect } from '../geometry/types'
import { createItem, createToken } from '../state/defaults'
import { newId } from '../state/ids'
import { autoBadge, nextNumberedName } from '../state/naming'
import { MAX_NAME_LENGTH, MAX_NOTES_LENGTH, MAX_TAG_LENGTH } from '../state/validate'
import {
  allItems,
  findItem,
  isItemMovable,
  isLayerInteractive,
  moveInLayer,
} from '../state/sceneOps'
import {
  FOOTPRINT_CELLS,
  LAYER_NAMES,
  type CampaignState,
  type Grid,
  type Id,
  type Item,
  type LayerName,
  type LayerState,
  type Scene,
  type SizeCategory,
  type Token,
  type TokenKind,
} from '../state/types'
import {
  activeSceneOf,
  commit,
  getCampaign,
  redo,
  setUnrecorded,
  undo,
  useCampaignStore,
} from './campaign'
import { useSessionStore } from './session'
import { notify, setSelection, useUiStore, type ClipboardEntry } from './ui'

/**
 * Editing actions on the active scene. Each user-visible change is one undo step.
 * Locked items and items on locked or hidden layers are never moved, transformed
 * or deleted here; the canvas does not offer them either.
 */

function sceneOf(draft: Draft<CampaignState>): Draft<Scene> {
  const scene = draft.scenes.find((s) => s.id === draft.activeSceneId)
  if (!scene) throw new Error('Active scene not found')
  return scene
}

export function currentScene(): Scene {
  return activeSceneOf(getCampaign())
}

function isToken(layer: LayerName, _item: Item): _item is Token {
  return layer === 'tokens'
}

/** Calls fn for every item of the scene whose id is in `ids`. */
function forEachIn(
  scene: Draft<Scene>,
  ids: ReadonlySet<Id>,
  fn: (item: Draft<Item>, layer: LayerName) => void,
): void {
  for (const layer of LAYER_NAMES) {
    for (const item of scene.layers[layer]) if (ids.has(item.id)) fn(item, layer)
  }
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`
}

// --- Selection ------------------------------------------------------------------

/** Keeps only ids of existing items on visible, unlocked layers. */
export function pruneSelection(): void {
  const { campaign } = useCampaignStore.getState()
  const { selection, hoveredId } = useUiStore.getState()
  if (!campaign) return
  const scene = activeSceneOf(campaign)
  const keep = selection.filter((id) => {
    const ref = findItem(scene, id)
    return ref !== null && isLayerInteractive(scene, ref.layer)
  })
  setSelection(keep)
  if (hoveredId !== null && !findItem(scene, hoveredId)) useUiStore.setState({ hoveredId: null })
}

/** Selected ids that can be moved (unlocked, on an interactive layer). */
export function movableIds(ids: readonly Id[]): Id[] {
  const scene = currentScene()
  return ids.filter((id) => {
    const ref = findItem(scene, id)
    return ref !== null && isItemMovable(scene, ref)
  })
}

function requireMovable(ids: readonly Id[], verb: string): Id[] {
  const movable = movableIds(ids)
  if (movable.length === 0 && ids.length > 0)
    notify(`Locked items can't be ${verb}. Unlock them first.`)
  return movable
}

// --- Placement ------------------------------------------------------------------

export interface PlaceOptions {
  /** Snap to the grid (snap setting on and Alt not held). */
  snap: boolean
}

/** What a newly placed token is made from: a preset or an uploaded token image. */
interface TokenSpec {
  assetId: string
  name: string
  kind: TokenKind
  sizeCategory: SizeCategory
}

function placeTokenFrom(spec: TokenSpec, at: Point, { snap }: PlaceOptions): Id {
  const scene = currentScene()
  const name = nextNumberedName(
    spec.name,
    scene.layers.tokens.map((t) => t.name),
  )
  const span = tokenSpan(spec.sizeCategory, scene.grid.size)
  const center = snap ? snapCenter(at, { width: span, height: span }, scene.grid, Infinity) : at
  const token = createToken({
    assetId: spec.assetId,
    name,
    kind: spec.kind,
    sizeCategory: spec.sizeCategory,
    color: useUiStore.getState().tokenColor ?? KIND_COLORS[spec.kind],
    badge: autoBadge(badgeStyleFor(spec.assetId), name),
    x: center.x,
    y: center.y,
    gridSize: scene.grid.size,
  })
  // Heroes see from the start (fog would otherwise stay black around them).
  if (spec.kind === 'player') token.visionFt = DEFAULT_PLAYER_VISION_FT
  commit(`Place ${name}`, (draft) => {
    sceneOf(draft).layers.tokens.push(token)
  })
  if (isLayerInteractive(currentScene(), 'tokens')) setSelection([token.id])
  return token.id
}

/** Places a token from a library preset centered at `at`. Returns its id. */
export function placeToken(presetId: string, at: Point, options: PlaceOptions): Id | null {
  const preset = getTokenPreset(presetId)
  return preset ? placeTokenFrom(preset, at, options) : null
}

/**
 * Places a token from an uploaded image with the asset's defaults (an unset
 * kind is 'enemy': a wrong guess then hides a token instead of revealing fog).
 */
export function placeUploadedToken(assetId: string, at: Point, options: PlaceOptions): Id | null {
  const asset = findUpload(getCampaign().library, assetId)
  if (!asset || asset.kind !== 'token') return null
  return placeTokenFrom(
    {
      assetId,
      name: asset.name,
      kind: asset.defaultKind ?? 'enemy',
      sizeCategory: asset.defaultSize ?? 'medium',
    },
    at,
    options,
  )
}

/**
 * Places a prop (default footprint) or a map (native size). `anchor: 'top-left'`
 * puts the item's top-left corner at `at` (snapped to a grid intersection).
 */
export function placeImage(
  assetId: string,
  at: Point,
  { snap, anchor = 'center' }: PlaceOptions & { anchor?: 'center' | 'top-left' },
): Id | null {
  const asset = placeableImage(getCampaign().library, assetId)
  if (!asset) return null
  const { grid } = currentScene()
  const width = asset.cells ? asset.cells.w * grid.size : asset.width
  const height = asset.cells ? asset.cells.h * grid.size : asset.height
  let center: Point
  if (anchor === 'top-left') {
    const left = snap ? nearestLine(at.x, grid.offsetX, grid.size) : at.x
    const top = snap ? nearestLine(at.y, grid.offsetY, grid.size) : at.y
    center = { x: left + width / 2, y: top + height / 2 }
  } else {
    center = snap ? snapCenter(at, { width, height }, grid, Infinity) : at
  }
  const item = createItem({ assetId, name: asset.name, x: center.x, y: center.y, width, height })
  const layer = asset.kind === 'map' ? 'map' : 'props'
  commit(`Place ${asset.name}`, (draft) => {
    sceneOf(draft).layers[layer].push(item)
  })
  setSelection(isLayerInteractive(currentScene(), layer) ? [item.id] : [])
  return item.id
}

// --- Move and transform ---------------------------------------------------------

export function moveItems(positions: Readonly<Record<Id, Point>>): void {
  const ids = new Set(movableIds(Object.keys(positions)))
  if (ids.size === 0) return
  commit(`Move ${plural(ids.size, 'item')}`, (draft) => {
    forEachIn(sceneOf(draft), ids, (item) => {
      const to = positions[item.id]
      if (to) {
        item.x = to.x
        item.y = to.y
      }
    })
  })
}

export interface ItemGeometry {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

/** Applies a Transformer gesture. Tokens keep their footprint size (they only rotate). */
export function transformItems(changes: Readonly<Record<Id, ItemGeometry>>): void {
  const ids = new Set(movableIds(Object.keys(changes)))
  if (ids.size === 0) return
  commit(`Transform ${plural(ids.size, 'item')}`, (draft) => {
    forEachIn(sceneOf(draft), ids, (item, layer) => {
      const next = changes[item.id]
      if (!next) return
      item.x = next.x
      item.y = next.y
      item.rotation = mod(next.rotation, 360)
      if (layer !== 'tokens') {
        item.width = Math.max(1, next.width)
        item.height = Math.max(1, next.height)
      }
    })
  })
}

/** Moves items by (dx, dy) world px; repeated nudges within a second are one undo step. */
export function nudgeItems(ids: readonly Id[], dx: number, dy: number): void {
  const movable = requireMovable(ids, 'moved')
  if (movable.length === 0) return
  const set = new Set(movable)
  commit(
    `Nudge ${plural(set.size, 'item')}`,
    (draft) => {
      forEachIn(sceneOf(draft), set, (item) => {
        item.x += dx
        item.y += dy
      })
    },
    { coalesceKey: `nudge:${movable.join(',')}` },
  )
}

// --- Delete, duplicate, copy, paste ---------------------------------------------

export function deleteItems(ids: readonly Id[]): void {
  const movable = requireMovable(ids, 'deleted')
  if (movable.length === 0) return
  const set = new Set(movable)
  commit(`Delete ${plural(set.size, 'item')}`, (draft) => {
    const scene = sceneOf(draft)
    scene.layers.map = scene.layers.map.filter((item) => !set.has(item.id))
    scene.layers.props = scene.layers.props.filter((item) => !set.has(item.id))
    scene.layers.tokens = scene.layers.tokens.filter((item) => !set.has(item.id))
  })
  setSelection(useUiStore.getState().selection.filter((id) => !set.has(id)))
}

function clipboardEntries(ids: readonly Id[]): ClipboardEntry[] {
  const scene = currentScene()
  const wanted = new Set(ids)
  return allItems(scene)
    .filter(({ item }) => wanted.has(item.id))
    .map(({ layer, item }) => ({ layer, item: structuredClone(item) }))
}

/**
 * Inserts copies of the entries translated by `delta`, on top of their layers.
 * Tokens are renumbered ("Goblin 2" -> "Goblin 3") and resized to this scene's grid.
 */
function insertCopies(entries: readonly ClipboardEntry[], delta: Point, label: string): Id[] {
  if (entries.length === 0) return []
  const scene = currentScene()
  const tokenNames = scene.layers.tokens.map((t) => t.name)
  const copies: { layer: LayerName; item: Item | Token }[] = entries.map(({ layer, item }) => {
    const copy = { ...structuredClone(item), id: newId(), x: item.x + delta.x, y: item.y + delta.y }
    if (isToken(layer, copy) && isToken(layer, item)) {
      const name = nextNumberedName(item.name, tokenNames)
      tokenNames.push(name)
      const style = badgeStyleFor(item.assetId)
      copy.name = name
      if (item.badge === autoBadge(style, item.name)) copy.badge = autoBadge(style, name)
      copy.width = copy.height = tokenSpan(copy.sizeCategory, scene.grid.size)
    }
    return { layer, item: copy }
  })
  commit(label, (draft) => {
    const target = sceneOf(draft)
    for (const { layer, item } of copies) {
      if (isToken(layer, item)) target.layers.tokens.push(item)
      else if (layer === 'map') target.layers.map.push(item)
      else target.layers.props.push(item)
    }
  })
  const now = currentScene()
  const ids = copies
    .filter(({ layer }) => isLayerInteractive(now, layer))
    .map(({ item }) => item.id)
  setSelection(ids)
  return copies.map(({ item }) => item.id)
}

/** Duplicates items one cell down and to the right. */
export function duplicateItems(ids: readonly Id[]): Id[] {
  const { grid } = currentScene()
  const entries = clipboardEntries(ids)
  return insertCopies(
    entries,
    { x: grid.size, y: grid.size },
    `Duplicate ${plural(entries.length, 'item')}`,
  )
}

export function copyItems(ids: readonly Id[]): void {
  const entries = clipboardEntries(ids)
  if (entries.length === 0) return
  useUiStore.setState({ clipboard: entries, pasteCount: 0 })
  notify(`Copied ${plural(entries.length, 'item')}`)
}

/**
 * Pastes the clipboard. With a pointer position the copies are centered there,
 * moved by whole cells so grid alignment is kept; otherwise each paste is
 * offset by one more cell.
 */
export function pasteItems(at: Point | null): Id[] {
  const { clipboard, pasteCount } = useUiStore.getState()
  if (!clipboard || clipboard.length === 0) return []
  const { grid } = currentScene()
  let delta: Point
  const bounds = unionRects(clipboard.map(({ item }) => itemBounds(item)))
  if (at && bounds) {
    const center = rectCenter(bounds)
    delta = {
      x: Math.round((at.x - center.x) / grid.size) * grid.size,
      y: Math.round((at.y - center.y) / grid.size) * grid.size,
    }
  } else {
    delta = { x: (pasteCount + 1) * grid.size, y: (pasteCount + 1) * grid.size }
  }
  useUiStore.setState({ pasteCount: pasteCount + 1 })
  return insertCopies(clipboard, delta, `Paste ${plural(clipboard.length, 'item')}`)
}

// --- Flags and order ------------------------------------------------------------

function refsOf(ids: readonly Id[]): Item[] {
  const scene = currentScene()
  return ids.flatMap((id) => findItem(scene, id)?.item ?? [])
}

/** Hides all if any is visible, otherwise shows all (H). */
export function toggleHidden(ids: readonly Id[]): void {
  const items = refsOf(ids)
  if (items.length === 0) return
  const hide = items.some((item) => !item.hidden)
  setHidden(ids, hide)
}

export function setHidden(ids: readonly Id[], hidden: boolean): void {
  const set = new Set(ids)
  commit(`${hidden ? 'Hide' : 'Show'} ${plural(set.size, 'item')}`, (draft) => {
    forEachIn(sceneOf(draft), set, (item) => {
      item.hidden = hidden
    })
  })
}

/** Locks all if any is unlocked, otherwise unlocks all (L). */
export function toggleLocked(ids: readonly Id[]): void {
  const items = refsOf(ids)
  if (items.length === 0) return
  const lock = items.some((item) => !item.locked)
  const set = new Set(ids)
  commit(`${lock ? 'Lock' : 'Unlock'} ${plural(set.size, 'item')}`, (draft) => {
    forEachIn(sceneOf(draft), set, (item) => {
      item.locked = lock
    })
  })
}

function sameOrder(a: readonly { id: Id }[], b: readonly { id: Id }[]): boolean {
  return a.every((item, i) => item.id === b[i]?.id)
}

/** Bring forward / send backward one step within each item's layer. */
export function reorderItems(ids: readonly Id[], direction: 'forward' | 'backward'): void {
  const set = new Set(ids)
  commit(direction === 'forward' ? 'Bring forward' : 'Send backward', (draft) => {
    const { layers } = sceneOf(draft)
    const map = moveInLayer(layers.map, set, direction)
    const props = moveInLayer(layers.props, set, direction)
    const tokens = moveInLayer(layers.tokens, set, direction)
    if (!sameOrder(map, layers.map)) layers.map = map
    if (!sameOrder(props, layers.props)) layers.props = props
    if (!sameOrder(tokens, layers.tokens)) layers.tokens = tokens
  })
}

// --- Properties -----------------------------------------------------------------

export type ItemPatch = Partial<Pick<Item, 'name' | 'opacity' | 'rotation' | 'hidden' | 'locked'>>
export type TokenPatch = ItemPatch &
  Partial<
    Pick<
      Token,
      | 'color'
      | 'badge'
      | 'sizeCategory'
      | 'kind'
      | 'label'
      | 'showLabel'
      | 'visionFt'
      | 'hp'
      | 'conditions'
      | 'dmNotes'
      | 'initiativeModifier'
    >
  >

/** Longest vision radius accepted (feet): beyond any 5e sense, small enough to rasterize. */
export const MAX_VISION_FT = 1000
/** Vision of a new player token, or of a token that becomes one without vision (darkvision, 18 m). */
export const DEFAULT_PLAYER_VISION_FT = 60
export const MAX_CONDITIONS = 20

/** Whole hit points: max from 1 to 9999, current from -max (massive damage) to max. */
function cleanHp(hp: Token['hp']): Token['hp'] {
  if (hp === null) return null
  const max = Math.min(9999, Math.max(1, Math.round(Number.isFinite(hp.max) ? hp.max : 1)))
  const current = Math.min(
    max,
    Math.max(-max, Math.round(Number.isFinite(hp.current) ? hp.current : max)),
  )
  return { current, max, publicBar: hp.publicBar }
}

/** Trimmed, unique (case-insensitive), at most MAX_CONDITIONS of at most 64 characters. */
export function cleanConditions(conditions: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of conditions) {
    const condition = raw.trim().slice(0, MAX_TAG_LENGTH)
    if (condition === '' || seen.has(condition.toLowerCase())) continue
    seen.add(condition.toLowerCase())
    result.push(condition)
  }
  return result.slice(0, MAX_CONDITIONS)
}

/**
 * Edits one item. A token rename also renames an automatic badge; a size change
 * rewrites the footprint keeping the top-left corner, so grid alignment survives.
 */
export function updateItem(
  id: Id,
  patch: TokenPatch,
  options: { coalesceKey?: string } = {},
): void {
  const ref = findItem(currentScene(), id)
  if (!ref) return
  const label = `Edit ${ref.item.name}`
  commit(
    label,
    (draft) => {
      const scene = sceneOf(draft)
      forEachIn(scene, new Set([id]), (item, layer) => {
        if (patch.name !== undefined) item.name = patch.name.slice(0, MAX_NAME_LENGTH)
        if (patch.opacity !== undefined) item.opacity = Math.min(1, Math.max(0, patch.opacity))
        if (patch.rotation !== undefined) item.rotation = mod(patch.rotation, 360)
        if (patch.hidden !== undefined) item.hidden = patch.hidden
        if (patch.locked !== undefined) item.locked = patch.locked
        if (!isToken(layer, item)) return
        const style = badgeStyleFor(item.assetId)
        if (patch.name !== undefined && item.badge === autoBadge(style, ref.item.name)) {
          item.badge = autoBadge(style, patch.name)
        }
        if (patch.badge !== undefined) item.badge = patch.badge
        if (patch.color !== undefined) item.color = patch.color
        if (patch.kind !== undefined) {
          if (patch.kind === 'player' && item.kind !== 'player' && item.visionFt === null) {
            item.visionFt = DEFAULT_PLAYER_VISION_FT
          }
          item.kind = patch.kind
        }
        if (patch.label !== undefined) {
          const text = patch.label?.slice(0, MAX_NAME_LENGTH) ?? null
          item.label = text === null || text.trim() === '' ? null : text
        }
        if (patch.showLabel !== undefined) item.showLabel = patch.showLabel
        if (patch.visionFt !== undefined) {
          const vision = patch.visionFt
          item.visionFt =
            vision === null || !Number.isFinite(vision) || vision <= 0
              ? null
              : Math.min(MAX_VISION_FT, vision)
        }
        if (patch.hp !== undefined) item.hp = cleanHp(patch.hp)
        if (patch.conditions !== undefined) item.conditions = cleanConditions(patch.conditions)
        if (patch.dmNotes !== undefined) item.dmNotes = patch.dmNotes.slice(0, MAX_NOTES_LENGTH)
        if (patch.initiativeModifier !== undefined) {
          const modifier = patch.initiativeModifier
          item.initiativeModifier =
            modifier === null || !Number.isFinite(modifier)
              ? null
              : Math.min(99, Math.max(-99, Math.round(modifier)))
        }
        if (patch.sizeCategory !== undefined && patch.sizeCategory !== item.sizeCategory) {
          const span = FOOTPRINT_CELLS[patch.sizeCategory] * scene.grid.size
          item.x = item.x - item.width / 2 + span / 2
          item.y = item.y - item.height / 2 + span / 2
          item.width = span
          item.height = span
          item.sizeCategory = patch.sizeCategory
        }
      })
    },
    options,
  )
}

// --- Grid and layers ------------------------------------------------------------

export type GridPatch = Partial<Omit<Grid, 'type'>>

/**
 * Edits the active scene's grid. A new cell size resizes every token's footprint
 * (keeping centers) and, while explored fog memory is still empty, recreates it
 * at the new quarter-cell resolution.
 */
export function updateGrid(
  patch: GridPatch,
  options: { coalesceKey?: string; label?: string } = {},
): void {
  const scene = currentScene()
  const size =
    patch.size === undefined ? scene.grid.size : clampGridSize(patch.size, scene.grid.size)
  commit(
    options.label ?? 'Grid settings',
    (draft) => {
      const target = sceneOf(draft)
      const grid = target.grid
      if (patch.visible !== undefined) grid.visible = patch.visible
      if (patch.color !== undefined) grid.color = patch.color
      if (patch.opacity !== undefined) grid.opacity = Math.min(1, Math.max(0, patch.opacity))
      if (patch.feetPerCell !== undefined && patch.feetPerCell > 0)
        grid.feetPerCell = patch.feetPerCell
      if (size !== grid.size) {
        grid.size = size
        for (const token of target.layers.tokens) {
          token.width = token.height = FOOTPRINT_CELLS[token.sizeCategory] * size
        }
      }
      grid.offsetX = mod(patch.offsetX ?? grid.offsetX, size)
      grid.offsetY = mod(patch.offsetY ?? grid.offsetY, size)
    },
    options,
  )
  const sceneId = scene.id
  setUnrecorded((draft) => {
    const memory = draft.sceneMemory[sceneId]
    if (memory && Object.keys(memory.explored.chunks).length === 0)
      memory.explored.cellPx = size / 4
  })
}

/** Grid calibration from a box drawn over `cells` x `cells` cells. Returns false if the box is too small. */
export function calibrateGrid(box: Rect, cells: number): boolean {
  const result = calibrateFromBox(box, cells)
  if (!result) return false
  updateGrid(result, { label: 'Calibrate grid' })
  notify(`Grid set to ${Math.round(result.size * 10) / 10} px per cell`)
  return true
}

export function setLayerState(layer: LayerName, patch: Partial<LayerState>): void {
  const words: string[] = []
  if (patch.visible !== undefined) words.push(patch.visible ? 'Show' : 'Hide')
  if (patch.locked !== undefined) words.push(patch.locked ? 'Lock' : 'Unlock')
  commit(`${words.join(' and ')} ${layer} layer`, (draft) => {
    const state = sceneOf(draft).layerState[layer]
    if (patch.visible !== undefined) state.visible = patch.visible
    if (patch.locked !== undefined) state.locked = patch.locked
  })
  pruneSelection()
}

export function setSnapEnabled(snapEnabled: boolean): void {
  setUnrecorded((draft) => {
    draft.settings.snapEnabled = snapEnabled
  })
}

// --- History ----------------------------------------------------------------------

/**
 * While players watch (a player window is connected and blackout is off),
 * undo and redo never switch the scene players see: they could reveal a scene
 * the DM is still preparing. Returns the name of the scene the step would show,
 * or null if it can run.
 */
function sceneSwitchBlocked(target: Id | undefined): string | null {
  const { campaign } = useCampaignStore.getState()
  if (!campaign || target === undefined || target === campaign.activeSceneId) return null
  if (useSessionStore.getState().players === 0 || campaign.presentation.blackout) return null
  return campaign.scenes.find((scene) => scene.id === target)?.name ?? 'the scene you deleted'
}

function explainBlocked(verb: 'Undo' | 'Redo', scene: string): void {
  notify(`${verb} would show players “${scene}”. Switch to that scene first, or turn on blackout.`)
}

export function undoAction(): void {
  const blocked = sceneSwitchBlocked(useCampaignStore.getState().past.at(-1)?.sceneBefore)
  if (blocked !== null) {
    explainBlocked('Undo', blocked)
    return
  }
  if (undo()) pruneSelection()
}

export function redoAction(): void {
  const blocked = sceneSwitchBlocked(useCampaignStore.getState().future.at(-1)?.sceneAfter)
  if (blocked !== null) {
    explainBlocked('Redo', blocked)
    return
  }
  if (redo()) pruneSelection()
}

// --- Views ------------------------------------------------------------------------

/** Bounds of everything on visible layers, or null for an empty scene. */
export function contentBounds(scene: Scene): Rect | null {
  return unionRects(
    allItems(scene)
      .filter(({ layer }) => scene.layerState[layer].visible)
      .map(({ item }) => itemBounds(item)),
  )
}
