import { applyPatches, enablePatches, produce, produceWithPatches, type Draft } from 'immer'
import { create } from 'zustand'
import type { CampaignState, Id, Scene } from '../state/types'
import { pushEntry, recordedPatches, type HistoryEntry } from './history'

/**
 * The persisted CampaignState and its undo history (DM window only).
 *
 * Every change to `scenes` or `name` goes through `commit`, which records Immer
 * patches for undo. Other top-level fields change through `setUnrecorded` and are
 * never rolled back (see RECORDED_KEYS). The store starts empty: the DM session
 * (src/dm/session.ts) loads a campaign from IndexedDB once it holds the DM lock.
 */
export interface CampaignStore {
  campaign: CampaignState | null
  past: HistoryEntry[]
  future: HistoryEntry[]
}

enablePatches()

export const useCampaignStore = create<CampaignStore>()(() => ({
  campaign: null,
  past: [],
  future: [],
}))

export type Recipe = (draft: Draft<CampaignState>) => void

export function getCampaign(): CampaignState {
  const { campaign } = useCampaignStore.getState()
  if (!campaign) throw new Error('No campaign loaded')
  return campaign
}

/** Replaces the whole campaign (load, import, gist pull) and clears the history. */
export function loadCampaign(campaign: CampaignState): void {
  useCampaignStore.setState({ campaign, past: [], future: [] })
}

/** Unloads the campaign (another tab took over). */
export function unloadCampaign(): void {
  useCampaignStore.setState({ campaign: null, past: [], future: [] })
}

/** Forgets undo history (after an asset deletion removed items it could bring back). */
export function clearHistory(): void {
  useCampaignStore.setState({ past: [], future: [] })
}

/** Makes `preferred` the active scene if it exists; otherwise keeps a valid active scene. */
function withActiveScene(campaign: CampaignState, preferred: Id): CampaignState {
  const has = (id: Id) => campaign.scenes.some((scene) => scene.id === id)
  const target = has(preferred)
    ? preferred
    : has(campaign.activeSceneId)
      ? campaign.activeSceneId
      : (campaign.scenes[0]?.id ?? campaign.activeSceneId)
  if (target === campaign.activeSceneId) return campaign
  return produce(campaign, (draft) => {
    draft.activeSceneId = target
  })
}

function touched(campaign: CampaignState): CampaignState {
  return produce(campaign, (draft) => {
    draft.updatedAt = Date.now()
  })
}

/**
 * Applies an undoable change. Returns false if nothing changed. Consecutive
 * commits with the same `coalesceKey` within a second merge into one undo step.
 */
export function commit(
  label: string,
  recipe: Recipe,
  options: { coalesceKey?: string } = {},
): boolean {
  const { campaign, past } = useCampaignStore.getState()
  if (!campaign) return false
  const [next, patches, inversePatches] = produceWithPatches(campaign, recipe)
  if (patches.length === 0) return false
  const recorded = recordedPatches(patches)
  const entry: HistoryEntry = {
    label,
    patches: recorded,
    inversePatches: recordedPatches(inversePatches),
    coalesceKey: options.coalesceKey ?? null,
    time: Date.now(),
    sceneBefore: campaign.activeSceneId,
    sceneAfter: next.activeSceneId,
  }
  useCampaignStore.setState({
    campaign: touched(next),
    ...(recorded.length > 0 ? { past: pushEntry(past, entry), future: [] } : {}),
  })
  return true
}

/** Changes state that undo must not roll back (settings, presentation, sceneMemory...). */
export function setUnrecorded(recipe: Recipe): void {
  const { campaign } = useCampaignStore.getState()
  if (!campaign) return
  const next = produce(campaign, recipe)
  if (next !== campaign) useCampaignStore.setState({ campaign: touched(next) })
}

export function undo(): HistoryEntry | null {
  const { campaign, past, future } = useCampaignStore.getState()
  const entry = past.at(-1)
  if (!campaign || !entry) return null
  useCampaignStore.setState({
    campaign: touched(
      withActiveScene(applyPatches(campaign, entry.inversePatches), entry.sceneBefore),
    ),
    past: past.slice(0, -1),
    future: [...future, { ...entry, coalesceKey: null }],
  })
  return entry
}

export function redo(): HistoryEntry | null {
  const { campaign, past, future } = useCampaignStore.getState()
  const entry = future.at(-1)
  if (!campaign || !entry) return null
  useCampaignStore.setState({
    campaign: touched(withActiveScene(applyPatches(campaign, entry.patches), entry.sceneAfter)),
    past: [...past, entry],
    future: future.slice(0, -1),
  })
  return entry
}

/** The active scene of a campaign. */
export function activeSceneOf(campaign: CampaignState): Scene {
  const scene = campaign.scenes.find((s) => s.id === campaign.activeSceneId)
  if (!scene) throw new Error(`Active scene ${campaign.activeSceneId} not found`)
  return scene
}

/** Hook: the active scene. Only for components rendered while a campaign is loaded. */
export function useActiveScene(): Scene {
  return useCampaignStore((s) => {
    if (!s.campaign) throw new Error('No campaign loaded')
    return activeSceneOf(s.campaign)
  })
}

/** Hook: one field of the loaded campaign. */
export function useCampaign<T>(select: (campaign: CampaignState) => T): T {
  return useCampaignStore((s) => {
    if (!s.campaign) throw new Error('No campaign loaded')
    return select(s.campaign)
  })
}
