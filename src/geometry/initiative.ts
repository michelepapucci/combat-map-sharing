import type { InitiativeEntry, Scene } from '../state/types'

/**
 * Initiative order and visibility (SPEC §5.7, §5.8, Decision 16). Entries are
 * stored unsorted; every view sorts them with sortInitiative.
 */

type Sortable = Pick<InitiativeEntry, 'id' | 'value' | 'dexTiebreak' | 'manualOrder'>

/** Higher first; a missing dex tiebreak sorts after any number. */
function compareTiebreak(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return b - a
}

/**
 * Turn order: descending value, then descending dex tiebreak (null last), then
 * ascending manual (drag-and-drop) order, then id so the order is total and stable.
 */
export function compareInitiative(a: Sortable, b: Sortable): number {
  if (a.value !== b.value) return b.value - a.value
  const dex = compareTiebreak(a.dexTiebreak, b.dexTiebreak)
  if (dex !== 0) return dex
  if (a.manualOrder !== b.manualOrder) return a.manualOrder - b.manualOrder
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** The entries in turn order, as a new array (the input is not modified). */
export function sortInitiative<T extends Sortable>(entries: readonly T[]): T[] {
  return entries.toSorted(compareInitiative)
}

/**
 * Whether players may see an entry. 'hidden' and 'shown' are explicit DM
 * overrides; 'auto' hides it while its token is missing, hidden or on a hidden
 * tokens layer (it follows the token, not the fog). An 'auto' entry without a
 * token (added by name) is shown.
 */
export function effectiveVisibility(
  entry: Pick<InitiativeEntry, 'tokenId' | 'visibility'>,
  scene: Pick<Scene, 'layers' | 'layerState'>,
): 'shown' | 'hidden' {
  if (entry.visibility === 'shown') return 'shown'
  if (entry.visibility !== 'auto') return 'hidden'
  if (entry.tokenId === null) return 'shown'
  const token = scene.layers.tokens.find((t) => t.id === entry.tokenId)
  if (!token || token.hidden !== false || scene.layerState.tokens.visible !== true) return 'hidden'
  return 'shown'
}
