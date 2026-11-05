import { FOG_CHUNK, FOG_CHUNK_BYTES, type FogMask, type Id } from '../state/types'
import {
  chunkKey,
  decodeChunk,
  encodeChunk,
  shapeBounds,
  shapeContains,
  type FogRules,
  type VisionCircle,
  type VisionSource,
} from './fog'
import type { Point, Rect } from './types'

/**
 * Explored fog memory (SceneMemory.explored) as it grows, plus the pure half of
 * drawing it (chunk tiles). A mask cell counts as covered by a shape when its
 * CENTER is inside the shape, with the same distance rule as fog.ts (`inCircle`),
 * so a rasterized circle reads back through `isExplored` exactly as `inCircle`
 * answers for the cell centers. Masks are never mutated: growth returns a new
 * mask, or null when no bit changed (so callers can skip a store update).
 *
 * Explored memory records only what players could see: a cell whose final
 * manual state is "hide" (the last manual edit covering its center hides it,
 * as in fogRegionAt) is never recorded, whatever vision covers it.
 */

/** Manual fog edits in the order they apply (Scene.fog.manual). */
export type ManualEdits = FogRules['manual']

/** A circle swept along a straight segment (a token's drag); from == to is a circle. */
export interface Capsule {
  from: Point
  to: Point
  r: number
}

/** A single shape covering more mask cells than this is skipped (a bad value must never freeze the DM window). */
export const MAX_SHAPE_CELLS = 4_000_000
/** Work budget per call, in mask cells; shapes beyond it are skipped. */
export const MAX_CALL_CELLS = 8_000_000

/** The validator accepts chunk coordinates of at most six digits; cells beyond are never written. */
const MAX_CHUNK_INDEX = 999_999
const MIN_CELL = -MAX_CHUNK_INDEX * FOG_CHUNK
const MAX_CELL = (MAX_CHUNK_INDEX + 1) * FOG_CHUNK - 1

/** A mask with nothing explored. */
export function emptyMask(cellPx: number): FogMask {
  return { cellPx, chunks: {} }
}

/** Vision sources by token id: the `previous` argument of recordVision. */
export function sourcesById(sources: readonly VisionSource[]): Map<Id, VisionSource> {
  return new Map(sources.map((source) => [source.tokenId, source]))
}

/** Marks every cell whose center is inside any circle. Null when nothing changed. */
export function rasterizeCircles(mask: FogMask, circles: readonly VisionCircle[]): FogMask | null {
  return rasterizeCapsules(
    mask,
    circles.map((circle) => ({ from: circle, to: circle, r: circle.r })),
  )
}

/**
 * Marks every cell whose center is within r of the capsule's segment (the area a
 * circle sweeps moving in a straight line). Null when nothing changed.
 */
export function rasterizeCapsules(
  mask: FogMask,
  capsules: readonly Capsule[],
  manual: ManualEdits = [],
): FogMask | null {
  const cellPx = mask.cellPx
  if (!(cellPx > 0) || !Number.isFinite(cellPx)) return null
  const writer = maskWriter(mask)
  const edits = manualEdits(manual)
  let budget = MAX_CALL_CELLS
  for (const capsule of capsules) {
    const cost = capsuleCost(capsule, cellPx)
    if (cost === null || cost > MAX_SHAPE_CELLS || cost > budget) continue
    budget -= cost
    fillCapsule(writer, capsule, cellPx, edits)
  }
  return writer.result()
}

/**
 * Records the manual reveals (players see them fully): every cell whose center
 * is inside a reveal and whose final manual state is still "reveal". Null when
 * nothing changed.
 */
export function rasterizeReveals(mask: FogMask, manual: ManualEdits): FogMask | null {
  const cellPx = mask.cellPx
  if (!(cellPx > 0) || !Number.isFinite(cellPx)) return null
  const writer = maskWriter(mask)
  const edits = manualEdits(manual)
  let budget = MAX_CALL_CELLS
  for (const edit of edits) {
    if (edit.hide || !edit.bounds) continue
    const { x, y, width, height } = edit.bounds
    const i0 = Math.max(MIN_CELL, Math.ceil(x / cellPx - 0.5))
    const i1 = Math.min(MAX_CELL, Math.floor((x + width) / cellPx - 0.5))
    const j0 = Math.max(MIN_CELL, Math.ceil(y / cellPx - 0.5))
    const j1 = Math.min(MAX_CELL, Math.floor((y + height) / cellPx - 0.5))
    const cost = (i1 - i0 + 1) * (j1 - j0 + 1)
    if (!(cost > 0) || cost > MAX_SHAPE_CELLS || cost > budget) continue
    budget -= cost
    for (let j = j0; j <= j1; j++) {
      const yc = (j + 0.5) * cellPx
      setRuns(writer, j, i0, i1, (i) => {
        const p = { x: (i + 0.5) * cellPx, y: yc }
        return shapeContains(edit.shape, p) && finalManualMode(edits, p) === 'reveal'
      })
    }
  }
  return writer.result()
}

/**
 * The growth rule for committed vision changes: a source whose token was at
 * another position in `previous` adds the capsule from its previous center to
 * the current one (current radius); a new source, or one whose radius changed,
 * adds its current circle. Unchanged sources add nothing (they are already
 * recorded) unless `all` is set: when recording starts, after the mask was
 * replaced or when the manual edits changed. Cells under a manual hide are
 * never recorded. Changed sources go first, so the work budget never drops them.
 */
export function recordVision(
  mask: FogMask,
  previous: ReadonlyMap<Id, VisionSource>,
  current: readonly VisionSource[],
  options: { manual?: ManualEdits; all?: boolean } = {},
): FogMask | null {
  const changed: Capsule[] = []
  const unchanged: Capsule[] = []
  for (const source of current) {
    const before = previous.get(source.tokenId)
    const known = before !== undefined && Number.isFinite(before.x) && Number.isFinite(before.y)
    const moved = known && (before.x !== source.x || before.y !== source.y)
    const capsule = { from: moved ? before : source, to: source, r: source.r }
    if (moved || !known || before.r !== source.r) changed.push(capsule)
    else if (options.all === true) unchanged.push(capsule)
  }
  if (changed.length === 0 && unchanged.length === 0) return null
  return rasterizeCapsules(mask, [...changed, ...unchanged], options.manual)
}

// ---------------------------------------------------------------------------
// Rasterizing
// ---------------------------------------------------------------------------

/** Estimated cells a capsule covers (area plus rows), or null when it is malformed. */
function capsuleCost({ from, to, r }: Capsule, cellPx: number): number | null {
  if (![from.x, from.y, to.x, to.y, r].every(Number.isFinite) || !(r > 0)) return null
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  const rows = (Math.abs(to.y - from.y) + 2 * r) / cellPx + 3
  const area = (Math.PI * r * r + 2 * r * length) / (cellPx * cellPx)
  return area + 2 * rows
}

/** fog.ts's distance rule (segmentDistance, inCircle for a = b): the point is within r of segment ab. */
function within(px: number, py: number, capsule: Capsule): boolean {
  const { from, to, r } = capsule
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length2 = dx * dx + dy * dy
  const t =
    length2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - from.x) * dx + (py - from.y) * dy) / length2))
  return Math.hypot(px - (from.x + t * dx), py - (from.y + t * dy)) <= r
}

/** Narrows [lo, hi] (values of u) to min <= a·u + b <= max. */
function constrain(
  [lo, hi]: [number, number],
  a: number,
  b: number,
  min: number,
  max: number,
): [number, number] {
  if (a === 0) return b >= min && b <= max ? [lo, hi] : [Infinity, -Infinity]
  const u1 = (min - b) / a
  const u2 = (max - b) / a
  return [Math.max(lo, Math.min(u1, u2)), Math.min(hi, Math.max(u1, u2))]
}

/**
 * The x interval where the horizontal line y = yc meets the capsule: the union of
 * its two end discs and the band along the segment (one interval, since a capsule
 * is convex), or null when the line misses it.
 */
function rowSpan(yc: number, { from, to, r }: Capsule): [number, number] | null {
  let lo = Infinity
  let hi = -Infinity
  for (const end of [from, to]) {
    const dy = yc - end.y
    if (Math.abs(dy) > r) continue
    const half = Math.sqrt(r * r - dy * dy)
    lo = Math.min(lo, end.x - half)
    hi = Math.max(hi, end.x + half)
  }
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length2 = dx * dx + dy * dy
  if (length2 > 0) {
    // u = x - from.x, w = yc - from.y: projection within the segment, distance within r.
    const w = yc - from.y
    const rl = r * Math.sqrt(length2)
    let band: [number, number] = [-Infinity, Infinity]
    band = constrain(band, dx, w * dy, 0, length2)
    band = constrain(band, -dy, w * dx, -rl, rl)
    if (band[0] <= band[1]) {
      lo = Math.min(lo, from.x + band[0])
      hi = Math.max(hi, from.x + band[1])
    }
  }
  return lo <= hi ? [lo, hi] : null
}

/** A manual edit with its bounds precomputed; `hide` also covers unknown modes (fail closed). */
interface PreparedEdit {
  hide: boolean
  shape: ManualEdits[number]['shape']
  bounds: Rect | null
}

function manualEdits(manual: ManualEdits): PreparedEdit[] {
  return manual.map((edit) => {
    const bounds = shapeBounds(edit.shape)
    const finite =
      bounds !== null && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    return { hide: edit.mode !== 'reveal', shape: edit.shape, bounds: finite ? bounds : null }
  })
}

function inBounds(bounds: Rect, x: number, y: number): boolean {
  return (
    x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height
  )
}

/** The mode of the last manual edit covering p (the one that wins), or null. */
function finalManualMode(edits: readonly PreparedEdit[], p: Point): 'reveal' | 'hide' | null {
  for (let k = edits.length - 1; k >= 0; k--) {
    const edit = edits[k]
    if (edit?.bounds && inBounds(edit.bounds, p.x, p.y) && shapeContains(edit.shape, p)) {
      return edit.hide ? 'hide' : 'reveal'
    }
  }
  return null
}

/** Sets the cells i0..i1 of row j for which `keep(i)` holds, as runs. */
function setRuns(
  writer: MaskWriter,
  j: number,
  i0: number,
  i1: number,
  keep: (i: number) => boolean,
): void {
  let start: number | null = null
  for (let i = i0; i <= i1; i++) {
    if (keep(i)) {
      start ??= i
    } else if (start !== null) {
      writer.setRow(j, start, i - 1)
      start = null
    }
  }
  if (start !== null) writer.setRow(j, start, i1)
}

/** Sets row j's cells i0..i1, except those a manual hide covers last. */
function setVisibleRow(
  writer: MaskWriter,
  j: number,
  i0: number,
  i1: number,
  cellPx: number,
  edits: readonly PreparedEdit[],
): void {
  const yc = (j + 0.5) * cellPx
  const x0 = (i0 + 0.5) * cellPx
  const x1 = (i1 + 0.5) * cellPx
  const hides = edits.filter(
    (edit) =>
      edit.hide &&
      edit.bounds !== null &&
      yc >= edit.bounds.y &&
      yc <= edit.bounds.y + edit.bounds.height &&
      x1 >= edit.bounds.x &&
      x0 <= edit.bounds.x + edit.bounds.width,
  )
  if (hides.length === 0) {
    writer.setRow(j, i0, i1)
    return
  }
  setRuns(writer, j, i0, i1, (i) => {
    const x = (i + 0.5) * cellPx
    if (!hides.some((edit) => edit.bounds && inBounds(edit.bounds, x, yc))) return true
    return finalManualMode(edits, { x, y: yc }) !== 'hide'
  })
}

function fillCapsule(
  writer: MaskWriter,
  capsule: Capsule,
  cellPx: number,
  edits: readonly PreparedEdit[],
): void {
  const center = (n: number) => (n + 0.5) * cellPx
  const minY = Math.min(capsule.from.y, capsule.to.y) - capsule.r
  const maxY = Math.max(capsule.from.y, capsule.to.y) + capsule.r
  // One extra row on each side: the exact rule below decides cells on the boundary.
  const j0 = Math.max(MIN_CELL, Math.ceil(minY / cellPx - 0.5) - 1)
  const j1 = Math.min(MAX_CELL, Math.floor(maxY / cellPx - 0.5) + 1)
  for (let j = j0; j <= j1; j++) {
    const yc = center(j)
    const span = rowSpan(yc, capsule)
    if (!span) continue
    let i0 = Math.max(MIN_CELL, Math.ceil(span[0] / cellPx - 0.5))
    let i1 = Math.min(MAX_CELL, Math.floor(span[1] / cellPx - 0.5))
    // Settle the ends with the exact rule, so the result matches inCircle cell by cell.
    while (i0 - 1 >= MIN_CELL && within(center(i0 - 1), yc, capsule)) i0--
    while (i0 <= i1 && !within(center(i0), yc, capsule)) i0++
    while (i1 + 1 <= MAX_CELL && within(center(i1 + 1), yc, capsule)) i1++
    while (i1 >= i0 && !within(center(i1), yc, capsule)) i1--
    if (i0 <= i1) setVisibleRow(writer, j, i0, i1, cellPx, edits)
  }
}

interface MaskWriter {
  /** Sets cells i0..i1 (inclusive) of row j. */
  setRow(j: number, i0: number, i1: number): void
  /** The new mask, or null when no bit changed. */
  result(): FogMask | null
}

/** Copy-on-write access to a mask's chunks: decodes each touched chunk once. */
function maskWriter(mask: FogMask): MaskWriter {
  const working = new Map<string, Uint8Array>()
  const dirty = new Set<string>()

  const chunk = (key: string): Uint8Array => {
    let bits = working.get(key)
    if (!bits) {
      const data = Object.hasOwn(mask.chunks, key) ? mask.chunks[key] : undefined
      bits = new Uint8Array(FOG_CHUNK_BYTES)
      if (typeof data === 'string') {
        try {
          bits = decodeChunk(data) // A fresh array: safe to write.
        } catch {
          // Malformed: it reads as unexplored (fail closed), so start from empty.
        }
      }
      working.set(key, bits)
    }
    return bits
  }

  return {
    setRow(j, i0, i1) {
      const cy = Math.floor(j / FOG_CHUNK)
      const rowStart = (j - cy * FOG_CHUNK) * FOG_CHUNK
      for (let cx = Math.floor(i0 / FOG_CHUNK); cx <= Math.floor(i1 / FOG_CHUNK); cx++) {
        const base = cx * FOG_CHUNK
        const key = chunkKey(cx, cy)
        const bits = chunk(key)
        let changed = false
        const end = rowStart + Math.min(i1, base + FOG_CHUNK - 1) - base
        for (let k = rowStart + Math.max(i0, base) - base; k <= end; k++) {
          const b = k >> 3
          const bit = 1 << (k & 7)
          const byte = bits[b] ?? 0
          if ((byte & bit) === 0) {
            bits[b] = byte | bit
            changed = true
          }
        }
        if (changed) dirty.add(key)
      }
    },
    result() {
      if (dirty.size === 0) return null
      const chunks = new Map<string, string>()
      for (const key of Object.keys(mask.chunks)) {
        const data = mask.chunks[key]
        if (typeof data === 'string') chunks.set(key, data)
      }
      for (const key of dirty) {
        const bits = working.get(key)
        const data = bits ? encodeChunk(bits) : null
        if (data === null) chunks.delete(key)
        else chunks.set(key, data)
      }
      // fromEntries defines own properties, so no key can reach the prototype.
      return { cellPx: mask.cellPx, chunks: Object.fromEntries(chunks) }
    },
  }
}

// ---------------------------------------------------------------------------
// Chunk tiles (drawing explored memory)
// ---------------------------------------------------------------------------

/**
 * Side in px of a chunk tile: one pixel per mask cell, FOG_CHUNK cells plus a
 * one-cell apron copied from the neighboring chunks, so smoothing (bilinear
 * filtering) blends across chunk borders exactly as inside a chunk.
 */
export const FOG_TILE = FOG_CHUNK + 2

/**
 * The decoded chunks around a tile, row-major from (-1, -1): index
 * (dy + 1) * 3 + (dx + 1), the tile's own chunk at 4. null = nothing explored.
 */
export type ChunkNeighborhood = readonly (Uint8Array | null)[]

/** A chunk of explored memory to draw. */
export interface ExploredTile {
  cx: number
  cy: number
  /** Content key: tiles with equal keys have identical pixels (wherever they are). */
  key: string
  neighborhood: ChunkNeighborhood
}

/** Whether cell (i, j) of the tile's chunk is set; i and j may be -1 or FOG_CHUNK (the apron). */
function neighborhoodBit(neighborhood: ChunkNeighborhood, i: number, j: number): boolean {
  const dx = i < 0 ? -1 : i >= FOG_CHUNK ? 1 : 0
  const dy = j < 0 ? -1 : j >= FOG_CHUNK ? 1 : 0
  const bits = neighborhood[(dy + 1) * 3 + (dx + 1)]
  if (!bits) return false
  const k = (j - dy * FOG_CHUNK) * FOG_CHUNK + (i - dx * FOG_CHUNK)
  return (((bits[k >> 3] ?? 0) >> (k & 7)) & 1) === 1
}

/** A tile's apron cells: rows -1 and FOG_CHUNK (corners included), then columns -1 and FOG_CHUNK. */
const APRON_CELLS: readonly (readonly [number, number])[] = [
  ...Array.from({ length: FOG_TILE }, (_, n) => [n - 1, -1] as const),
  ...Array.from({ length: FOG_TILE }, (_, n) => [n - 1, FOG_CHUNK] as const),
  ...Array.from({ length: FOG_CHUNK }, (_, j) => [-1, j] as const),
  ...Array.from({ length: FOG_CHUNK }, (_, j) => [FOG_CHUNK, j] as const),
]

/** The tile's apron cells packed as bits (the part of its key that comes from the neighbors). */
function apronBytes(neighborhood: ChunkNeighborhood): { bytes: Uint8Array; any: boolean } {
  const bytes = new Uint8Array(Math.ceil(APRON_CELLS.length / 8))
  let any = false
  APRON_CELLS.forEach(([i, j], n) => {
    if (!neighborhoodBit(neighborhood, i, j)) return
    bytes[n >> 3] = (bytes[n >> 3] ?? 0) | (1 << (n & 7))
    any = true
  })
  return { bytes, any }
}

/**
 * A tile's RGBA pixels (FOG_TILE × FOG_TILE, row-major): opaque white where the
 * cell is explored, transparent elsewhere. Pixel (1, 1) is the chunk's cell (0, 0).
 */
export function tilePixels(neighborhood: ChunkNeighborhood): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(FOG_TILE * FOG_TILE * 4)
  for (let ty = 0; ty < FOG_TILE; ty++) {
    for (let tx = 0; tx < FOG_TILE; tx++) {
      if (!neighborhoodBit(neighborhood, tx - 1, ty - 1)) continue
      pixels.fill(255, (ty * FOG_TILE + tx) * 4, (ty * FOG_TILE + tx + 1) * 4)
    }
  }
  return pixels
}

const CHUNK_KEY = /^(-?\d+),(-?\d+)$/

/**
 * The tiles that draw a mask: every chunk with explored cells, plus the empty
 * chunks next to them whose apron is not empty (their soft edge). Malformed
 * chunks count as unexplored (fail closed).
 */
export function exploredTiles(mask: FogMask): ExploredTile[] {
  if (!(mask.cellPx > 0) || !Number.isFinite(mask.cellPx)) return []
  const decoded = new Map<string, { data: string; bits: Uint8Array }>()
  for (const key of Object.keys(mask.chunks)) {
    const data = mask.chunks[key]
    if (typeof data !== 'string' || !CHUNK_KEY.test(key)) continue
    try {
      const bits = decodeChunk(data)
      if (bits.some((byte) => byte !== 0)) decoded.set(key, { data, bits })
    } catch {
      // Malformed: unexplored.
    }
  }
  const candidates = new Map<string, { cx: number; cy: number }>()
  for (const key of decoded.keys()) {
    const match = CHUNK_KEY.exec(key)
    if (!match) continue
    const cx = Number(match[1])
    const cy = Number(match[2])
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        candidates.set(chunkKey(cx + dx, cy + dy), { cx: cx + dx, cy: cy + dy })
      }
    }
  }
  const tiles: ExploredTile[] = []
  for (const { cx, cy } of candidates.values()) {
    const neighborhood: (Uint8Array | null)[] = []
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        neighborhood.push(decoded.get(chunkKey(cx + dx, cy + dy))?.bits ?? null)
      }
    }
    const own = decoded.get(chunkKey(cx, cy))
    const apron = apronBytes(neighborhood)
    if (!own && !apron.any) continue
    const key = `${own?.data ?? ''}|${String.fromCharCode(...apron.bytes)}`
    tiles.push({ cx, cy, key, neighborhood })
  }
  return tiles
}
