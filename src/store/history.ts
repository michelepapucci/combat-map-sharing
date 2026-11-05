import type { Patch } from 'immer'
import type { Id } from '../state/types'

/**
 * Undo history (pure). Entries hold Immer patches; consecutive commits with the
 * same coalesce key within COALESCE_WINDOW_MS merge into one entry (slider
 * gestures, repeated nudges). See "State" in CLAUDE.md.
 */
export interface HistoryEntry {
  label: string
  patches: Patch[]
  inversePatches: Patch[]
  coalesceKey: string | null
  /** When the entry was last extended (ms). */
  time: number
  /**
   * The active scene before and after the change. Undo shows `sceneBefore` and
   * redo `sceneAfter` (when they still exist), so an undone change is never
   * invisible and undoing "Delete scene" lands on the restored scene.
   */
  sceneBefore: Id
  sceneAfter: Id
}

export const HISTORY_LIMIT = 200
export const COALESCE_WINDOW_MS = 1000

/**
 * Top-level CampaignState keys that undo records. Everything else (sceneMemory,
 * presentation, settings, library, activeSceneId, updatedAt) is never rolled
 * back by undo. A recorded action may change those fields in the same recipe
 * (a new scene's memory, switching to it): the change applies but is not undone.
 */
export const RECORDED_KEYS: ReadonlySet<string> = new Set(['scenes', 'name'])

export function recordedPatches(patches: readonly Patch[]): Patch[] {
  return patches.filter((patch) => RECORDED_KEYS.has(String(patch.path[0])))
}

/** Appends an entry (or merges it into the last one), capping the history length. */
export function pushEntry(past: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const last = past.at(-1)
  if (
    entry.coalesceKey !== null &&
    last?.coalesceKey === entry.coalesceKey &&
    entry.time - last.time <= COALESCE_WINDOW_MS &&
    // Never merge changes made in different scenes (undo shows one scene).
    entry.sceneBefore === last.sceneAfter
  ) {
    const merged: HistoryEntry = {
      ...last,
      patches: [...last.patches, ...entry.patches],
      inversePatches: [...entry.inversePatches, ...last.inversePatches],
      time: entry.time,
      sceneAfter: entry.sceneAfter,
    }
    return [...past.slice(0, -1), merged]
  }
  const next = [...past, entry]
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next
}
