import {
  affectedCells,
  affectedTokenIds,
  countable,
  type AoeGrid,
  type TemplateGeometry,
} from '../../geometry/aoe'
import type { AoeCoverageRule } from '../../state/types'

/**
 * What a template affects, computed once per template geometry, grid and rule
 * and shared by the canvas highlight, the tool bar and the panel (a huge
 * template can take tens of milliseconds to count). Tokens are cheap to test
 * against the cached cells, so they are checked on every call.
 */

export interface Affected {
  cells: readonly { i: number; j: number }[]
  tokenIds: string[]
  /** Too large to count (affectedCells' work cap): the counts are unknown, not zero. */
  tooLarge: boolean
}

const CACHE_SIZE = 16
const cache = new Map<string, { cells: { i: number; j: number }[]; tooLarge: boolean }>()

function cellsOf(t: TemplateGeometry, grid: AoeGrid, rule: AoeCoverageRule) {
  const key = JSON.stringify([
    t.shape,
    t.originX,
    t.originY,
    t.sizeFt,
    t.widthFt,
    t.directionDeg,
    grid.size,
    grid.offsetX,
    grid.offsetY,
    grid.feetPerCell,
    rule,
  ])
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const entry = { cells: affectedCells(t, grid, rule), tooLarge: !countable(t, grid) }
  cache.set(key, entry)
  for (const old of cache.keys()) {
    if (cache.size <= CACHE_SIZE) break
    cache.delete(old)
  }
  return entry
}

export function affectedBy(
  t: TemplateGeometry,
  grid: AoeGrid,
  rule: AoeCoverageRule,
  tokens: readonly { id: string; x: number; y: number; width: number; height: number }[],
): Affected {
  const { cells, tooLarge } = cellsOf(t, grid, rule)
  return { cells, tokenIds: affectedTokenIds(t, grid, rule, tokens, cells), tooLarge }
}

/** "17 squares, 3 tokens affected", or why there is no count. */
export function affectedText(affected: Affected): string {
  if (affected.tooLarge) return 'Too large to count the squares it affects'
  const squares = affected.cells.length
  const tokens = affected.tokenIds.length
  return `${squares} ${squares === 1 ? 'square' : 'squares'}, ${tokens} ${tokens === 1 ? 'token' : 'tokens'} affected`
}
