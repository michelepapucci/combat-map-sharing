import {
  FOG_CHUNK,
  FOG_CHUNK_BYTES,
  type FogEditMode,
  type FogMask,
  type FogShape,
  type Grid,
  type Id,
  type Scene,
  type Settings,
  type Token,
} from '../state/types'
import type { Point, Rect } from './types'

/**
 * Fog of war rules (SPEC §5.6, CLAUDE.md "Fog"), shared by the projection, the
 * fog renderers and "Preview as players". Everything here is pure and fails
 * closed: anything malformed (NaN points, undecodable chunks, a flag that is not
 * a boolean) counts as dark or hidden.
 */

/** A circle of the currently visible area, world px. */
export interface VisionCircle {
  x: number
  y: number
  r: number
}

export interface VisionSource extends VisionCircle {
  tokenId: Id
}

/** What players see at a point: clear, dimmed (explored memory) or black. */
export type FogRegion = 'visible' | 'explored' | 'dark'

/** The fog settings a region query needs; PlayerFog-shaped edits work too. */
export interface FogRules {
  enabled: boolean
  exploredEnabled: boolean
  manual: readonly { mode: FogEditMode; shape: FogShape }[]
}

// ---------------------------------------------------------------------------
// Vision sources
// ---------------------------------------------------------------------------

/** A vision range in feet as a radius in world px on this grid. */
export function visionRadiusPx(visionFt: number, grid: Pick<Grid, 'size' | 'feetPerCell'>): number {
  return (visionFt / grid.feetPerCell) * grid.size
}

/**
 * THE vision-source selector (CLAUDE.md "Projection rule"): a token that is not
 * hidden, on a visible tokens layer, with visionFt > 0, and a player (or an NPC
 * when settings.npcVision). Committed positions only: live drags never move vision.
 * An NPC standing where the DM hid the map by hand (a manual 'hide' edit covers
 * its center) gives no vision: its circle around a dark spot would tell players
 * where it is. Player tokens are always shown, so their circles stay.
 */
export function visionSources(
  scene: Pick<Scene, 'grid' | 'layers' | 'layerState'> & {
    fog?: { manual: readonly FogRules['manual'][number][] }
  },
  settings: Pick<Settings, 'npcVision'>,
): VisionSource[] {
  const sources = candidateSources(scene, settings)
  const manual = scene.fog?.manual ?? []
  if (!manual.some((edit) => edit.mode === 'hide')) return sources.map(({ source }) => source)
  const rules: FogRules = { enabled: true, exploredEnabled: false, manual }
  const circles = sources.map(({ source }) => source)
  return sources
    .filter(
      ({ kind, source }) =>
        kind === 'player' || fogRegionAt(source, rules, circles, null) !== 'dark',
    )
    .map(({ source }) => source)
}

function candidateSources(
  scene: Pick<Scene, 'grid' | 'layers' | 'layerState'>,
  settings: Pick<Settings, 'npcVision'>,
): { kind: Token['kind']; source: VisionSource }[] {
  if (scene.layerState.tokens.visible !== true) return []
  const sources: { kind: Token['kind']; source: VisionSource }[] = []
  for (const token of scene.layers.tokens) {
    if (token.hidden !== false) continue
    if (!(token.kind === 'player' || (token.kind === 'npc' && settings.npcVision === true)))
      continue
    if (token.visionFt === null || !(token.visionFt > 0)) continue
    const r = visionRadiusPx(token.visionFt, scene.grid)
    if (!(r > 0) || !Number.isFinite(r) || !Number.isFinite(token.x) || !Number.isFinite(token.y)) {
      continue
    }
    sources.push({ kind: token.kind, source: { tokenId: token.id, x: token.x, y: token.y, r } })
  }
  return sources
}

export function inCircle(circle: VisionCircle, p: Point): boolean {
  return Math.hypot(p.x - circle.x, p.y - circle.y) <= circle.r
}

// ---------------------------------------------------------------------------
// Manual fog shapes
// ---------------------------------------------------------------------------

/** Distance from p to the segment ab. */
function segmentDistance(p: Point, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const length2 = dx * dx + dy * dy
  const t =
    length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / length2))
  return Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy))
}

/** Flat [x0, y0, x1, y1, ...] as points (a trailing odd coordinate is ignored). */
function pairs(flat: readonly number[]): Point[] {
  const points: Point[] = []
  for (let k = 0; k + 1 < flat.length; k += 2) {
    points.push({ x: flat[k] ?? NaN, y: flat[k + 1] ?? NaN })
  }
  return points
}

/** Even-odd ray casting; points on an edge count as inside, like the rectangle's edges. */
function inPolygon(flat: readonly number[], p: Point): boolean {
  const vertices = pairs(flat)
  if (vertices.length < 3) return false
  let inside = false
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i]
    const b = vertices[j]
    if (!a || !b) continue
    if (segmentDistance(p, a.x, a.y, b.x, b.y) <= 1e-9) return true
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/** A round brush of `radius` dragged along the points (a single point is a disc). */
function inBrush(flat: readonly number[], radius: number, p: Point): boolean {
  const points = pairs(flat)
  const first = points[0]
  if (!first) return false
  if (points.length === 1) return Math.hypot(p.x - first.x, p.y - first.y) <= radius
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1]
    const b = points[k]
    if (a && b && segmentDistance(p, a.x, a.y, b.x, b.y) <= radius) return true
  }
  return false
}

/** Whether a manual fog shape covers the point (edges included). */
export function shapeContains(shape: FogShape, p: Point): boolean {
  switch (shape.type) {
    case 'rect': {
      const x0 = Math.min(shape.x, shape.x + shape.width)
      const x1 = Math.max(shape.x, shape.x + shape.width)
      const y0 = Math.min(shape.y, shape.y + shape.height)
      const y1 = Math.max(shape.y, shape.y + shape.height)
      return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1
    }
    case 'polygon':
      return inPolygon(shape.points, p)
    case 'brush':
      return inBrush(shape.points, shape.radius, p)
  }
}

function pointsBounds(points: readonly Point[], pad: number): Rect | null {
  if (points.length === 0) return null
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs) - pad
  const y = Math.min(...ys) - pad
  return { x, y, width: Math.max(...xs) + pad - x, height: Math.max(...ys) + pad - y }
}

/** Axis-aligned bounds of a manual fog shape, or null when it covers nothing. */
export function shapeBounds(shape: FogShape): Rect | null {
  switch (shape.type) {
    case 'rect':
      return {
        x: Math.min(shape.x, shape.x + shape.width),
        y: Math.min(shape.y, shape.y + shape.height),
        width: Math.abs(shape.width),
        height: Math.abs(shape.height),
      }
    case 'polygon': {
      const vertices = pairs(shape.points)
      return vertices.length < 3 ? null : pointsBounds(vertices, 0)
    }
    case 'brush':
      return pointsBounds(pairs(shape.points), shape.radius)
  }
}

// ---------------------------------------------------------------------------
// Explored memory (FogMask)
// ---------------------------------------------------------------------------

/** The key of chunk (cx, cy) in FogMask.chunks (never "-0"). */
export function chunkKey(cx: number, cy: number): string {
  return `${cx === 0 ? 0 : cx},${cy === 0 ? 0 : cy}`
}

/**
 * A chunk's base64 as FOG_CHUNK_BYTES bytes (zero-padded). Throws on invalid
 * base64 or more than FOG_CHUNK_BYTES bytes.
 */
export function decodeChunk(data: string): Uint8Array {
  const binary = atob(data)
  if (binary.length > FOG_CHUNK_BYTES) {
    throw new Error(`fog chunk has ${binary.length} bytes, more than ${FOG_CHUNK_BYTES}`)
  }
  const bits = new Uint8Array(FOG_CHUNK_BYTES)
  for (let b = 0; b < binary.length; b++) bits[b] = binary.charCodeAt(b)
  return bits
}

/**
 * A chunk's bytes as base64 with trailing zero bytes dropped, or null for an
 * all-zero chunk (which the mask must not store). Throws on more than
 * FOG_CHUNK_BYTES bytes.
 */
export function encodeChunk(bits: Uint8Array): string | null {
  if (bits.length > FOG_CHUNK_BYTES) {
    throw new Error(`fog chunk has ${bits.length} bytes, more than ${FOG_CHUNK_BYTES}`)
  }
  let end = bits.length
  while (end > 0 && bits[end - 1] === 0) end--
  if (end === 0) return null
  let binary = ''
  for (let b = 0; b < end; b++) binary += String.fromCharCode(bits[b] ?? 0)
  return btoa(binary)
}

/**
 * Decoded chunks per mask object. Each entry remembers the string it was decoded
 * from, so a mask changed in place is decoded again; null = undecodable.
 */
const decodedChunks = new WeakMap<FogMask, Map<string, { data: string; bits: Uint8Array | null }>>()

function chunkBits(mask: FogMask, key: string): Uint8Array | null {
  const data = Object.hasOwn(mask.chunks, key) ? mask.chunks[key] : undefined
  if (typeof data !== 'string') return null
  let cache = decodedChunks.get(mask)
  if (!cache) {
    cache = new Map()
    decodedChunks.set(mask, cache)
  }
  const hit = cache.get(key)
  if (hit && hit.data === data) return hit.bits
  let bits: Uint8Array | null
  try {
    bits = decodeChunk(data)
  } catch {
    bits = null // Malformed: unexplored (fail closed).
  }
  cache.set(key, { data, bits })
  return bits
}

/** Whether the mask cell containing the point is explored. */
export function isExplored(mask: FogMask, point: Point): boolean {
  if (!(mask.cellPx > 0) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false
  const i = Math.floor(point.x / mask.cellPx)
  const j = Math.floor(point.y / mask.cellPx)
  const cx = Math.floor(i / FOG_CHUNK)
  const cy = Math.floor(j / FOG_CHUNK)
  const bits = chunkBits(mask, chunkKey(cx, cy))
  if (!bits) return false
  const k = (j - cy * FOG_CHUNK) * FOG_CHUNK + (i - cx * FOG_CHUNK)
  return (((bits[k >> 3] ?? 0) >> (k & 7)) & 1) === 1
}

const CHUNK_KEY = /^(-?\d+),(-?\d+)$/

/** Bounding rectangle (world px) of every explored cell, or null if nothing is explored. */
export function exploredBounds(mask: FogMask): Rect | null {
  if (!(mask.cellPx > 0)) return null
  let minI = Infinity
  let minJ = Infinity
  let maxI = -Infinity
  let maxJ = -Infinity
  for (const key of Object.keys(mask.chunks)) {
    const match = CHUNK_KEY.exec(key)
    const bits = match ? chunkBits(mask, key) : null
    if (!match || !bits) continue
    const baseI = Number(match[1]) * FOG_CHUNK
    const baseJ = Number(match[2]) * FOG_CHUNK
    for (let b = 0; b < bits.length; b++) {
      const byte = bits[b] ?? 0
      if (byte === 0) continue
      for (let bit = 0; bit < 8; bit++) {
        if (((byte >> bit) & 1) === 0) continue
        const k = b * 8 + bit
        const i = baseI + (k % FOG_CHUNK)
        const j = baseJ + Math.floor(k / FOG_CHUNK)
        minI = Math.min(minI, i)
        maxI = Math.max(maxI, i)
        minJ = Math.min(minJ, j)
        maxJ = Math.max(maxJ, j)
      }
    }
  }
  if (minI === Infinity) return null
  return {
    x: minI * mask.cellPx,
    y: minJ * mask.cellPx,
    width: (maxI - minI + 1) * mask.cellPx,
    height: (maxJ - minJ + 1) * mask.cellPx,
  }
}

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

/**
 * The fog region at a point. Fog off: visible. Otherwise visible inside a vision
 * circle, else explored (when explored memory is on and the cell is explored),
 * else dark; then the manual edits apply in order on top ('reveal' → visible,
 * 'hide' → dark). A missing mask counts as nothing explored.
 */
export function fogRegionAt(
  point: Point,
  fog: FogRules,
  circles: readonly VisionCircle[],
  explored: FogMask | null,
): FogRegion {
  if (fog.enabled === false) return 'visible'
  let region: FogRegion = 'dark'
  if (circles.some((circle) => inCircle(circle, point))) region = 'visible'
  else if (fog.exploredEnabled === true && explored && isExplored(explored, point))
    region = 'explored'
  for (const edit of fog.manual) {
    if (shapeContains(edit.shape, point)) region = edit.mode === 'reveal' ? 'visible' : 'dark'
  }
  return region
}

/** The parts of an item that place its footprint. */
export interface Footprint {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

/** cos/sin of a clockwise rotation in degrees, exact at multiples of 90°. */
function rotation(degrees: number): { cos: number; sin: number } {
  const quarter = (((degrees % 360) + 360) % 360) / 90
  if (Number.isInteger(quarter)) {
    return (
      [
        { cos: 1, sin: 0 },
        { cos: 0, sin: 1 },
        { cos: -1, sin: 0 },
        { cos: 0, sin: -1 },
      ][quarter] ?? { cos: 1, sin: 0 }
    )
  }
  const radians = (degrees * Math.PI) / 180
  return { cos: Math.cos(radians), sin: Math.sin(radians) }
}

/**
 * The nine sample points of an item's rotated footprint (Decision 29): center,
 * corners (top-left, top-right, bottom-right, bottom-left) and edge midpoints
 * (top, right, bottom, left), named before rotation.
 */
export function samplePoints(item: Footprint): Point[] {
  const { cos, sin } = rotation(item.rotation)
  const hw = item.width / 2
  const hh = item.height / 2
  const offsets: [number, number][] = [
    [0, 0],
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
    [0, -hh],
    [hw, 0],
    [0, hh],
    [-hw, 0],
  ]
  // Clockwise on screen (y down): the standard rotation matrix.
  return offsets.map(([dx, dy]) => ({
    x: item.x + dx * cos - dy * sin,
    y: item.y + dx * sin + dy * cos,
  }))
}

/**
 * The clearest region among an item's nine sample points: 'visible' if any point
 * is visible, else 'explored' if any is explored, else 'dark'. Enemy and NPC
 * tokens are shown only when 'visible'; props unless 'dark'.
 */
export function footprintRegion(
  item: Footprint,
  fog: FogRules,
  circles: readonly VisionCircle[],
  explored: FogMask | null,
): FogRegion {
  if (fog.enabled === false) return 'visible'
  let best: FogRegion = 'dark'
  for (const point of samplePoints(item)) {
    const region = fogRegionAt(point, fog, circles, explored)
    if (region === 'visible') return 'visible'
    if (region === 'explored') best = 'explored'
  }
  return best
}
