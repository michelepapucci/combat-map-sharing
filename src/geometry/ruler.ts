import type { DiagonalRule, Grid, UnitSystem } from '../state/types'
import { pathCells } from './distance'
import { cellCenter } from './grid'
import type { Point } from './types'
import { formatLength } from './units'

/**
 * The ruler (SPEC §5.4): points snap to cell centers by default, the length
 * follows the campaign's diagonal rule. The DM window and the projection both
 * measure with rulerLength, so the TV shows the DM's number.
 */

/** The center of the cell containing `p`. */
export function snapRulerPoint(p: Point, grid: Pick<Grid, 'size' | 'offsetX' | 'offsetY'>): Point {
  return {
    x: cellCenter(p.x, grid.offsetX, grid.size),
    y: cellCenter(p.y, grid.offsetY, grid.size),
  }
}

/** Length of a path through world points, in cells and feet. */
export function rulerLength(
  points: readonly Point[],
  grid: Pick<Grid, 'size' | 'feetPerCell'>,
  rule: DiagonalRule,
): { cells: number; feet: number } {
  if (!(grid.size > 0)) return { cells: 0, feet: 0 }
  const cells = pathCells(
    points.map((p) => ({ x: p.x / grid.size, y: p.y / grid.size })),
    rule,
  )
  return { cells, feet: cells * grid.feetPerCell }
}

/** "9 m · 6 sq" (euclidean lengths keep one decimal). */
export function rulerLabel(feet: number, cells: number, units: UnitSystem): string {
  const squares = Math.round(cells * 10) / 10
  return `${formatLength(feet, units)} · ${squares} sq`
}
