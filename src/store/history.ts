import type { Patch } from 'immer'

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
}

export const HISTORY_LIMIT = 200
export const COALESCE_WINDOW_MS = 1000

/**
 * Top-level CampaignState keys that undo records. Everything else (sceneMemory,
 * presentation, settings, library, updatedAt) is never rolled back by undo.
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
    entry.time - last.time <= COALESCE_WINDOW_MS
  ) {
    const merged: HistoryEntry = {
      ...last,
      patches: [...last.patches, ...entry.patches],
      inversePatches: [...entry.inversePatches, ...last.inversePatches],
      time: entry.time,
    }
    return [...past.slice(0, -1), merged]
  }
  const next = [...past, entry]
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next
}
