import type { DiagonalRule } from '../state/types'
import type { Point } from './types'

/**
 * Grid distances (SPEC §5.4), measured in cells between cell positions.
 * - 'five': every square costs one cell, diagonals included (5e default).
 * - 'alternating': diagonals alternate 1, 2, 1, 2... cells (DMG variant). The
 *   alternation carries across the segments of a path.
 * - 'euclidean': straight-line length.
 */

export interface SegmentCost {
  cells: number
  /** Diagonal steps taken so far along the path (drives the alternating rule). */
  diagonals: number
}

/**
 * Cost of a move of (dx, dy) cells. For the grid rules dx/dy are rounded to whole
 * cells; `diagonalsBefore` is the number of diagonal steps taken earlier in the path.
 */
export function segmentCells(
  dx: number,
  dy: number,
  rule: DiagonalRule,
  diagonalsBefore = 0,
): SegmentCost {
  if (rule === 'euclidean') return { cells: Math.hypot(dx, dy), diagonals: diagonalsBefore }
  const ax = Math.abs(Math.round(dx))
  const ay = Math.abs(Math.round(dy))
  const diagonal = Math.min(ax, ay)
  const straight = Math.max(ax, ay) - diagonal
  const total = diagonalsBefore + diagonal
  if (rule === 'five') return { cells: straight + diagonal, diagonals: total }
  // The k-th diagonal of the path (1-based) costs 2 when k is even.
  const evenDiagonals = Math.floor(total / 2) - Math.floor(diagonalsBefore / 2)
  return { cells: straight + diagonal + evenDiagonals, diagonals: total }
}

/** Length of a path through points given in cell units. */
export function pathCells(points: readonly Point[], rule: DiagonalRule): number {
  let cells = 0
  let diagonals = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (!a || !b) continue
    const cost = segmentCells(b.x - a.x, b.y - a.y, rule, diagonals)
    cells += cost.cells
    diagonals = cost.diagonals
  }
  return cells
}

/** Distance in feet between two world points on a grid of `gridSize` px cells. */
export function worldDistanceFeet(
  from: Point,
  to: Point,
  gridSize: number,
  feetPerCell: number,
  rule: DiagonalRule,
): number {
  const { cells } = segmentCells((to.x - from.x) / gridSize, (to.y - from.y) / gridSize, rule)
  return cells * feetPerCell
}
