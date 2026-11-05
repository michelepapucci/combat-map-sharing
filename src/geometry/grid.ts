import type { Grid } from '../state/types'
import type { Rect } from './types'

/** The parts of a grid that position math needs. */
export type GridFrame = Pick<Grid, 'size' | 'offsetX' | 'offsetY'>

/** Smallest and largest accepted cell size in world px. */
export const MIN_GRID_SIZE = 4
export const MAX_GRID_SIZE = 2000

/** Euclidean modulo: the result has the sign of n. */
export function mod(a: number, n: number): number {
  return ((a % n) + n) % n
}

/** The grid line (on one axis) closest to v. */
export function nearestLine(v: number, offset: number, size: number): number {
  return offset + Math.round((v - offset) / size) * size
}

/** The center of the cell containing v (on one axis). */
export function cellCenter(v: number, offset: number, size: number): number {
  return offset + (Math.floor((v - offset) / size) + 0.5) * size
}

/** Grid line positions within [min, max] on one axis, at most `limit` of them. */
export function linesInRange(
  min: number,
  max: number,
  offset: number,
  size: number,
  limit = 2000,
): number[] {
  const lines: number[] = []
  const first = Math.ceil((min - offset) / size)
  for (let i = first; offset + i * size <= max && lines.length < limit; i++) {
    lines.push(offset + i * size)
  }
  return lines
}

/** Clamps a cell size to the accepted range (non-finite input falls back to `fallback`). */
export function clampGridSize(size: number, fallback: number): number {
  if (!Number.isFinite(size)) return fallback
  return Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, size))
}

/**
 * Grid calibration (SPEC §5.1): the DM drew `box` over `cells` x `cells` cells of
 * the grid printed on the map. Returns the cell size (the mean of both axes) and
 * an offset normalized to [0, size), or null if the box is too small.
 */
export function calibrateFromBox(
  box: Rect,
  cells: number,
): { size: number; offsetX: number; offsetY: number } | null {
  if (!(cells >= 1) || !Number.isFinite(cells)) return null
  const size = (box.width / cells + box.height / cells) / 2
  if (!(size >= MIN_GRID_SIZE) || size > MAX_GRID_SIZE) return null
  return { size, offsetX: mod(box.x, size), offsetY: mod(box.y, size) }
}
