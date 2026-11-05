import type { AoeCoverageRule, AoeShape, AoeTemplate } from '../state/types'
import { mod, nearestLine } from './grid'
import type { Point, Rect } from './types'

/**
 * Area-of-effect templates (SPEC §5.5): outlines, containment, the squares a
 * template affects under either coverage rule, the tokens on them, and the
 * placement helpers (origin snapping, size and direction from a drag).
 *
 * World px throughout; template lengths are in feet. `directionDeg` is degrees
 * clockwise from +x on screen (y points down), so 90° points down (+y).
 * Shapes:
 * - circle, cylinder: centered on the origin, radius `sizeFt`;
 * - cone: the 5e cone, an isosceles triangle with its apex at the origin, length
 *   `sizeFt` along the direction and a flat far edge as wide as it is long
 *   (its width at any distance equals that distance; total angle ≈ 53.13°);
 * - line: a `sizeFt` × `widthFt` rectangle starting at the origin, centered on
 *   the direction axis;
 * - cube: a `sizeFt` square with one corner at the origin, whose diagonal from
 *   that corner points along the direction (45° spans +x and +y).
 *
 * Malformed templates (non-finite numbers, `sizeFt <= 0`, a line with
 * `widthFt <= 0`, an unknown shape) and malformed grids (non-positive size or
 * feet per cell) cover nothing: no outline, no point, no cell, no token.
 */

/** The parts of a scene grid the template math needs (a `Grid` fits). */
export interface AoeGrid {
  /** Cell edge in world px. */
  size: number
  /** World position of a grid line intersection. */
  offsetX: number
  offsetY: number
  /** Feet per cell edge (5 in 5e). */
  feetPerCell: number
}

/** The fields of a template that decide where it is (a full `AoeTemplate` fits). */
export type TemplateGeometry = Pick<
  AoeTemplate,
  'shape' | 'originX' | 'originY' | 'sizeFt' | 'widthFt' | 'directionDeg'
>

/** Half the opening angle of a 5e cone, radians: its half-width is half its length. */
export const CONE_HALF_ANGLE: number = Math.atan(0.5)

/** Containment tolerance, world px: points on an edge count as inside. */
const EDGE_EPSILON = 1e-6
/** Tolerance of the 'half' rule, so a square covered exactly 50% counts. */
const HALF_EPSILON = 1e-9
/** affectedCells refuses templates whose bounds span more cells than this. */
const MAX_SCANNED_CELLS = 250_000
/** Placement sizes snap to this step, in feet (SPEC §5.5). */
const SIZE_STEP_FT = 5

/** A template resolved to world px: a circle or a convex polygon (positive signed area). */
type Resolved =
  { kind: 'circle'; x: number; y: number; r: number } | { kind: 'polygon'; points: Point[] }

/** A length in feet as world px on this grid. */
export function feetToPx(feet: number, grid: Pick<AoeGrid, 'size' | 'feetPerCell'>): number {
  return (feet / grid.feetPerCell) * grid.size
}

/** Circle/cylinder → {x,y,r} in world px; other shapes (and malformed templates) → null. */
export function templateCircle(
  t: TemplateGeometry,
  grid: AoeGrid,
): { x: number; y: number; r: number } | null {
  const shape = resolve(t, grid)
  return shape?.kind === 'circle' ? { x: shape.x, y: shape.y, r: shape.r } : null
}

/**
 * Polygon outline in world px as flat [x0,y0,x1,y1,...] for cone (3 points:
 * apex, then the far corners), line (4: start and far corners) and cube (4:
 * the origin corner first); circle/cylinder (and malformed templates) → null.
 * Vertices go clockwise on screen.
 */
export function templatePolygon(t: TemplateGeometry, grid: AoeGrid): number[] | null {
  const shape = resolve(t, grid)
  if (shape?.kind !== 'polygon') return null
  return shape.points.flatMap((p) => [p.x, p.y])
}

/** Whether a world point is inside the template (edges inclusive with a tiny epsilon). */
export function templateContains(t: TemplateGeometry, grid: AoeGrid, p: Point): boolean {
  const shape = resolve(t, grid)
  return shape !== null && contains(shape, p)
}

/**
 * Axis-aligned bounds in world px. A malformed template gives an empty rect at
 * its origin (or at 0, 0 when the origin is not finite).
 */
export function templateBounds(t: TemplateGeometry, grid: AoeGrid): Rect {
  const shape = resolve(t, grid)
  if (shape === null) {
    const finite = Number.isFinite(t.originX) && Number.isFinite(t.originY)
    return { x: finite ? t.originX : 0, y: finite ? t.originY : 0, width: 0, height: 0 }
  }
  return boundsOf(shape)
}

/**
 * Fraction (0..1) of cell (i, j) covered by the template: exact for polygons
 * (the convex outline clipped to the cell with Sutherland–Hodgman, then the
 * shoelace area) and for circles (closed-form circle–rectangle intersection).
 * Malformed input → 0.
 */
export function cellCoverage(t: TemplateGeometry, grid: AoeGrid, i: number, j: number): number {
  const shape = resolve(t, grid)
  if (shape === null || !Number.isFinite(i) || !Number.isFinite(j)) return 0
  return coverageOf(shape, grid, i, j)
}

/**
 * Affected cells, sorted by j then i. Rule 'center': the cell's center is inside
 * (edges inclusive); 'half': coverage >= 0.5 (with a 1e-9 tolerance, so exactly
 * half counts). Only cells within templateBounds are scanned. Malformed input,
 * or bounds spanning more than 250 000 cells, gives [].
 */
export function affectedCells(
  t: TemplateGeometry,
  grid: AoeGrid,
  rule: AoeCoverageRule,
): { i: number; j: number }[] {
  const shape = resolve(t, grid)
  if (shape === null || (rule !== 'center' && rule !== 'half')) return []
  const range = cellRange(boundsOf(shape), grid)
  if (range === null) return []
  const { size, offsetX, offsetY } = grid
  const cells: { i: number; j: number }[] = []
  for (let j = range.jMin; j <= range.jMax; j++) {
    for (let i = range.iMin; i <= range.iMax; i++) {
      const hit =
        rule === 'center'
          ? contains(shape, { x: offsetX + (i + 0.5) * size, y: offsetY + (j + 0.5) * size })
          : coverageOf(shape, grid, i, j) >= 0.5 - HALF_EPSILON
      if (hit) cells.push({ i, j })
    }
  }
  return cells
}

/**
 * Ids of tokens that have at least one affected cell in their footprint, in
 * input order. A token's footprint is the cells whose centers lie inside its
 * axis-aligned box (x ± width/2, y ± height/2, edges inclusive), plus always the
 * cell containing its center (so a tiny token has one). Tokens with a
 * non-finite position are never affected; a non-finite or negative size counts
 * as 0.
 */
export function affectedTokenIds(
  t: TemplateGeometry,
  grid: AoeGrid,
  rule: AoeCoverageRule,
  tokens: readonly { id: string; x: number; y: number; width: number; height: number }[],
  /** affectedCells(t, grid, rule), when the caller already has it. */
  precomputed?: readonly { i: number; j: number }[],
): string[] {
  const cells = precomputed ?? affectedCells(t, grid, rule)
  const first = cells[0]
  if (!first) return []
  const hit = new Set<string>()
  let iMin = first.i
  let iMax = first.i
  let jMin = first.j
  let jMax = first.j
  for (const { i, j } of cells) {
    hit.add(cellKey(i, j))
    iMin = Math.min(iMin, i)
    iMax = Math.max(iMax, i)
    jMin = Math.min(jMin, j)
    jMax = Math.max(jMax, j)
  }
  const { size, offsetX, offsetY } = grid
  const ids: string[] = []
  for (const token of tokens) {
    if (!Number.isFinite(token.x) || !Number.isFinite(token.y)) continue
    const halfW = token.width >= 0 && Number.isFinite(token.width) ? token.width / 2 : 0
    const halfH = token.height >= 0 && Number.isFinite(token.height) ? token.height / 2 : 0
    const ci = Math.floor((token.x - offsetX) / size)
    const cj = Math.floor((token.y - offsetY) / size)
    if (hit.has(cellKey(ci, cj))) {
      ids.push(token.id)
      continue
    }
    // Cells whose centers lie in the box, clamped to the affected cells' range
    // so an absurdly large token cannot make this loop long.
    const fiMin = Math.max(iMin, Math.ceil((token.x - halfW - offsetX - EDGE_EPSILON) / size - 0.5))
    const fiMax = Math.min(
      iMax,
      Math.floor((token.x + halfW - offsetX + EDGE_EPSILON) / size - 0.5),
    )
    const fjMin = Math.max(jMin, Math.ceil((token.y - halfH - offsetY - EDGE_EPSILON) / size - 0.5))
    const fjMax = Math.min(
      jMax,
      Math.floor((token.y + halfH - offsetY + EDGE_EPSILON) / size - 0.5),
    )
    if (anyCellIn(hit, fiMin, fiMax, fjMin, fjMax)) ids.push(token.id)
  }
  return ids
}

/**
 * Snaps a template origin (SPEC §5.5: "the origin snaps to grid intersections or
 * cell centers depending on the shape"). Circles and cylinders go to the
 * nearest point of the half-cell lattice (intersections, edge midpoints and cell
 * centers); lines likewise but never to an intersection (the nearest edge
 * midpoint instead, so a 5 ft line covers one row); cone and cube go to the nearest grid intersection. Respects the grid
 * offsets. A malformed grid or point is returned unchanged.
 */
export function snapTemplateOrigin(shape: AoeShape, p: Point, grid: AoeGrid): Point {
  const { size, offsetX, offsetY } = grid
  if (!(size > 0) || !Number.isFinite(size) || !Number.isFinite(offsetX + offsetY)) return p
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return p
  const step = shape === 'cone' || shape === 'cube' ? size : size / 2
  const snapped = { x: nearestLine(p.x, offsetX, step), y: nearestLine(p.y, offsetY, step) }
  if (shape !== 'line') return snapped
  // A line from an intersection would run along a grid line and straddle two rows
  // (its edges exactly on cell centers): lines start at edge midpoints or centers.
  const onLine = (v: number, offset: number) => {
    const r = (((v - offset) % size) + size) % size
    return r < 1e-9 * size || size - r < 1e-9 * size
  }
  if (!onLine(snapped.x, offsetX) || !onLine(snapped.y, offsetY)) return snapped
  const half = size / 2
  const candidates = [
    { x: snapped.x + half, y: snapped.y },
    { x: snapped.x - half, y: snapped.y },
    { x: snapped.x, y: snapped.y + half },
    { x: snapped.x, y: snapped.y - half },
  ]
  let best = candidates[0] ?? snapped
  for (const candidate of candidates) {
    if (Math.hypot(candidate.x - p.x, candidate.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y)) {
      best = candidate
    }
  }
  return best
}

/**
 * Whether affectedCells can count this template: false when it is malformed or
 * its bounds span more cells than the work cap (it would return []).
 */
export function countable(t: TemplateGeometry, grid: AoeGrid): boolean {
  const shape = resolve(t, grid)
  return shape !== null && cellRange(boundsOf(shape), grid) !== null
}

/**
 * Size and direction from a placement drag (origin → pointer).
 *
 * `directionDeg` is the drag's angle, normalized to [0, 360). With `snapDegrees`
 * set it is rounded to a multiple of `snapDegrees` counted from `snapOffsetDeg`
 * (default 0): cubes pass (90, 45) so the square stays axis-aligned, Shift-snapped
 * cones and lines e.g. (15). `null` leaves the direction free. A zero-length drag
 * uses `fallbackDirectionDeg` (default 0), snapped and normalized the same way.
 *
 * `sizeFt` is the drag length in feet (for a cube, the larger of the drag's
 * projections onto the square's two sides, after direction snapping, so the
 * pointer lies on the square), rounded to the nearest multiple of 5 ft and at
 * least 5 ft.
 */
export function templateFromDrag(
  shape: AoeShape,
  origin: Point,
  pointer: Point,
  grid: AoeGrid,
  options: { snapDegrees: number | null; snapOffsetDeg?: number; fallbackDirectionDeg?: number },
): { sizeFt: number; directionDeg: number } {
  const dx = pointer.x - origin.x
  const dy = pointer.y - origin.y
  const length = Math.hypot(dx, dy)
  const fallback = options.fallbackDirectionDeg ?? 0
  const raw =
    length > 0 && Number.isFinite(length)
      ? (Math.atan2(dy, dx) * 180) / Math.PI
      : Number.isFinite(fallback)
        ? fallback
        : 0
  const directionDeg = mod(snapAngle(raw, options.snapDegrees, options.snapOffsetDeg ?? 0), 360)

  let lengthPx = Number.isFinite(length) ? length : 0
  if (shape === 'cube') {
    const [ax, ay] = unitVector(directionDeg - 45)
    const [bx, by] = unitVector(directionDeg + 45)
    lengthPx = Math.max(0, dx * ax + dy * ay, dx * bx + dy * by)
    if (!Number.isFinite(lengthPx)) lengthPx = 0
  }
  const feet = (lengthPx / grid.size) * grid.feetPerCell
  const rounded = Math.round(feet / SIZE_STEP_FT) * SIZE_STEP_FT
  const sizeFt = Number.isFinite(rounded) ? Math.max(SIZE_STEP_FT, rounded) : SIZE_STEP_FT
  return { sizeFt, directionDeg }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function snapAngle(deg: number, snapDegrees: number | null, offsetDeg: number): number {
  if (snapDegrees === null || !(snapDegrees > 0) || !Number.isFinite(snapDegrees)) return deg
  const offset = Number.isFinite(offsetDeg) ? offsetDeg : 0
  return offset + Math.round((deg - offset) / snapDegrees) * snapDegrees
}

/**
 * (cos, sin) of an angle in degrees, exact at multiples of 45° so axis-aligned
 * templates have exact vertices (a cube at 45° spans exactly two cells).
 */
function unitVector(deg: number): [number, number] {
  const d = mod(deg, 360)
  switch (d) {
    case 0:
      return [1, 0]
    case 45:
      return [Math.SQRT1_2, Math.SQRT1_2]
    case 90:
      return [0, 1]
    case 135:
      return [-Math.SQRT1_2, Math.SQRT1_2]
    case 180:
      return [-1, 0]
    case 225:
      return [-Math.SQRT1_2, -Math.SQRT1_2]
    case 270:
      return [0, -1]
    case 315:
      return [Math.SQRT1_2, -Math.SQRT1_2]
    default: {
      const rad = (d * Math.PI) / 180
      return [Math.cos(rad), Math.sin(rad)]
    }
  }
}

function validGrid(grid: AoeGrid): boolean {
  return (
    grid.size > 0 &&
    Number.isFinite(grid.size) &&
    grid.feetPerCell > 0 &&
    Number.isFinite(grid.feetPerCell) &&
    Number.isFinite(grid.offsetX) &&
    Number.isFinite(grid.offsetY)
  )
}

/** The template in world px, or null when it is malformed (fails closed). */
function resolve(t: TemplateGeometry, grid: AoeGrid): Resolved | null {
  if (!validGrid(grid)) return null
  const { originX: x, originY: y } = t
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (!(t.sizeFt > 0) || !Number.isFinite(t.sizeFt)) return null
  const length = feetToPx(t.sizeFt, grid)
  if (!(length > 0) || !Number.isFinite(length)) return null
  if (t.shape === 'circle' || t.shape === 'cylinder') return { kind: 'circle', x, y, r: length }
  if (!Number.isFinite(t.directionDeg)) return null
  const [ux, uy] = unitVector(t.directionDeg)
  // Left of the direction on screen (y down): the direction turned 90° counterclockwise.
  const nx = uy
  const ny = -ux
  switch (t.shape) {
    case 'cone': {
      const fx = x + ux * length
      const fy = y + uy * length
      const half = length / 2
      return {
        kind: 'polygon',
        points: [
          { x, y },
          { x: fx + nx * half, y: fy + ny * half },
          { x: fx - nx * half, y: fy - ny * half },
        ],
      }
    }
    case 'line': {
      if (!(t.widthFt > 0) || !Number.isFinite(t.widthFt)) return null
      const half = feetToPx(t.widthFt, grid) / 2
      if (!(half > 0) || !Number.isFinite(half)) return null
      const fx = x + ux * length
      const fy = y + uy * length
      return {
        kind: 'polygon',
        points: [
          { x: x + nx * half, y: y + ny * half },
          { x: fx + nx * half, y: fy + ny * half },
          { x: fx - nx * half, y: fy - ny * half },
          { x: x - nx * half, y: y - ny * half },
        ],
      }
    }
    case 'cube': {
      const [ax, ay] = unitVector(t.directionDeg - 45)
      const [bx, by] = unitVector(t.directionDeg + 45)
      return {
        kind: 'polygon',
        points: [
          { x, y },
          { x: x + ax * length, y: y + ay * length },
          { x: x + (ax + bx) * length, y: y + (ay + by) * length },
          { x: x + bx * length, y: y + by * length },
        ],
      }
    }
    default:
      return null
  }
}

function contains(shape: Resolved, p: Point): boolean {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false
  if (shape.kind === 'circle')
    return Math.hypot(p.x - shape.x, p.y - shape.y) <= shape.r + EDGE_EPSILON
  // Convex, clockwise on screen: the inside is where every edge's cross product is >= 0.
  const { points } = shape
  for (let k = 0; k < points.length; k++) {
    const a = points[k]
    const b = points[(k + 1) % points.length]
    if (!a || !b) return false
    const ex = b.x - a.x
    const ey = b.y - a.y
    const edge = Math.hypot(ex, ey)
    if (edge === 0) continue
    if ((ex * (p.y - a.y) - ey * (p.x - a.x)) / edge < -EDGE_EPSILON) return false
  }
  return true
}

function boundsOf(shape: Resolved): Rect {
  if (shape.kind === 'circle') {
    return { x: shape.x - shape.r, y: shape.y - shape.r, width: 2 * shape.r, height: 2 * shape.r }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of shape.points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** The cells overlapping a rect (closed), or null when there are too many. */
function cellRange(
  bounds: Rect,
  grid: AoeGrid,
): { iMin: number; iMax: number; jMin: number; jMax: number } | null {
  const { size, offsetX, offsetY } = grid
  const iMin = Math.floor((bounds.x - offsetX) / size)
  const iMax = Math.floor((bounds.x + bounds.width - offsetX) / size)
  const jMin = Math.floor((bounds.y - offsetY) / size)
  const jMax = Math.floor((bounds.y + bounds.height - offsetY) / size)
  const count = (iMax - iMin + 1) * (jMax - jMin + 1)
  if (!Number.isFinite(count) || count > MAX_SCANNED_CELLS) return null
  return { iMin, iMax, jMin, jMax }
}

function coverageOf(shape: Resolved, grid: AoeGrid, i: number, j: number): number {
  const { size } = grid
  const x0 = grid.offsetX + i * size
  const y0 = grid.offsetY + j * size
  const x1 = x0 + size
  const y1 = y0 + size
  const area =
    shape.kind === 'circle'
      ? circleRectArea(x0 - shape.x, x1 - shape.x, y0 - shape.y, y1 - shape.y, shape.r)
      : polygonArea(clipToRect(shape.points, x0, y0, x1, y1))
  return Math.min(1, Math.max(0, area / (size * size)))
}

/** Sutherland–Hodgman: a convex polygon clipped to the rectangle [x0, x1] × [y0, y1]. */
function clipToRect(points: Point[], x0: number, y0: number, x1: number, y1: number): Point[] {
  let out = clipAxis(points, 'x', x0, 1)
  out = clipAxis(out, 'x', x1, -1)
  out = clipAxis(out, 'y', y0, 1)
  return clipAxis(out, 'y', y1, -1)
}

/** Keeps the part of the polygon where sign · (p[axis] − value) >= 0. */
function clipAxis(points: Point[], axis: 'x' | 'y', value: number, sign: 1 | -1): Point[] {
  const out: Point[] = []
  const last = points[points.length - 1]
  if (!last) return out
  let prev = last
  let prevSide = sign * (prev[axis] - value)
  for (const cur of points) {
    const curSide = sign * (cur[axis] - value)
    if (curSide >= 0 !== prevSide >= 0) {
      const t = prevSide / (prevSide - curSide)
      const crossing =
        axis === 'x'
          ? { x: value, y: prev.y + (cur.y - prev.y) * t }
          : { x: prev.x + (cur.x - prev.x) * t, y: value }
      out.push(crossing)
    }
    if (curSide >= 0) out.push(cur)
    prev = cur
    prevSide = curSide
  }
  return out
}

/** Unsigned shoelace area. */
function polygonArea(points: Point[]): number {
  let twice = 0
  for (let k = 0; k < points.length; k++) {
    const a = points[k]
    const b = points[(k + 1) % points.length]
    if (!a || !b) continue
    twice += a.x * b.y - b.x * a.y
  }
  return Math.abs(twice) / 2
}

/**
 * Area of the circle of radius r centered at (0, 0) intersected with the
 * rectangle [x0, x1] × [y0, y1] (x0 <= x1, y0 <= y1), in closed form.
 */
function circleRectArea(x0: number, x1: number, y0: number, y1: number, r: number): number {
  if (y0 >= 0) return circleCapArea(x0, x1, y0, r) - circleCapArea(x0, x1, y1, r)
  if (y1 <= 0) return circleRectArea(x0, x1, -y1, -y0, r)
  return circleRectArea(x0, x1, 0, -y0, r) + circleRectArea(x0, x1, 0, y1, r)
}

/** Area of the circle (radius r, centered at 0, 0) with x in [x0, x1] and y >= h, for h >= 0. */
function circleCapArea(x0: number, x1: number, h: number, r: number): number {
  if (h >= r) return 0
  const s = Math.sqrt(r * r - h * h)
  const a = Math.min(s, Math.max(-s, x0))
  const b = Math.min(s, Math.max(-s, x1))
  if (b <= a) return 0
  return capIntegral(b, h, r) - capIntegral(a, h, r)
}

/** Antiderivative of sqrt(r² − x²) − h. */
function capIntegral(x: number, h: number, r: number): number {
  const u = Math.min(1, Math.max(-1, x / r))
  return 0.5 * (x * Math.sqrt(Math.max(0, r * r - x * x)) + r * r * Math.asin(u)) - h * x
}

function cellKey(i: number, j: number): string {
  return `${i},${j}`
}

function anyCellIn(
  cells: ReadonlySet<string>,
  iMin: number,
  iMax: number,
  jMin: number,
  jMax: number,
): boolean {
  for (let j = jMin; j <= jMax; j++) {
    for (let i = iMin; i <= iMax; i++) {
      if (cells.has(cellKey(i, j))) return true
    }
  }
  return false
}
