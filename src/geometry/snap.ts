import { FOOTPRINT_CELLS, type SizeCategory } from '../state/types'
import { mod, nearestLine, type GridFrame } from './grid'
import type { Point, Size } from './types'

/**
 * Magnetic snapping (SPEC §5.1). Snapping works per axis on an item's axis-aligned
 * footprint: the center moves so that the nearer edge lands on a grid line, but
 * only if that edge is within `threshold` cells of the line. For a footprint of
 * whole cells this puts odd spans on cell centers and even spans on grid
 * intersections. Pass `threshold = Infinity` to always snap (placement).
 */
export const SNAP_THRESHOLD = 0.25

export function snapAxis(
  center: number,
  span: number,
  offset: number,
  size: number,
  threshold = SNAP_THRESHOLD,
): number {
  const lo = center - span / 2
  const hi = center + span / 2
  const dLo = nearestLine(lo, offset, size) - lo
  const dHi = nearestLine(hi, offset, size) - hi
  const delta = Math.abs(dLo) <= Math.abs(dHi) ? dLo : dHi
  return Math.abs(delta) <= threshold * size ? center + delta : center
}

/** Snaps a footprint center on both axes. */
export function snapCenter(
  center: Point,
  footprint: Size,
  grid: GridFrame,
  threshold = SNAP_THRESHOLD,
): Point {
  return {
    x: snapAxis(center.x, footprint.width, grid.offsetX, grid.size, threshold),
    y: snapAxis(center.y, footprint.height, grid.offsetY, grid.size, threshold),
  }
}

/** Snaps a single coordinate to the nearest grid line if within the threshold. */
export function snapToLine(
  v: number,
  offset: number,
  size: number,
  threshold = SNAP_THRESHOLD,
): number {
  const line = nearestLine(v, offset, size)
  return Math.abs(line - v) <= threshold * size ? line : v
}

/** A token's square footprint edge in world px. */
export function tokenSpan(sizeCategory: SizeCategory, gridSize: number): number {
  return FOOTPRINT_CELLS[sizeCategory] * gridSize
}

/** Whether a rotation (degrees) is a multiple of 90, allowing float noise. */
export function isRightAngle(rotation: number): boolean {
  const r = mod(rotation, 90)
  return r < 1e-6 || 90 - r < 1e-6
}

/**
 * The axis-aligned extent of a w x h rectangle rotated about its center. At
 * multiples of 90 degrees this is exact (w/h swapped at 90 and 270).
 */
export function rotatedExtent(width: number, height: number, rotation: number): Size {
  if (isRightAngle(rotation)) {
    const quarter = Math.round(mod(rotation, 360) / 90) % 2
    return quarter === 1 ? { width: height, height: width } : { width, height }
  }
  const rad = (rotation * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  return { width: width * cos + height * sin, height: width * sin + height * cos }
}
