import { create } from 'zustand'
import type { SaveStatus } from '../persistence/autosave'
import type { CampaignSummary } from '../persistence/db'

/**
 * DM session status (DM only): which window holds the edit lock, the autosave
 * indicator, and the local campaign list. Driven by src/dm/session.ts.
 */
export type SessionPhase =
  /** Waiting for the DM lock or loading the campaign. */
  | 'starting'
  /** This tab edits the campaign. */
  | 'ready'
  /** Another tab holds the DM lock; this one shows a "use this tab" screen. */
  | 'inactive'
  /** The last campaign could not be opened. */
  | 'failed'

export interface SessionState {
  phase: SessionPhase
  /** Why 'inactive': another tab was already open, or it took over from this one. */
  inactiveReason: 'open-elsewhere' | 'taken-over'
  /** Set in 'failed': the campaign that could not be opened, and why. */
  failure: { campaignId: string | null; message: string } | null
  saveStatus: SaveStatus
  /** User-facing explanation of the last failed save. */
  saveError: string | null
  /** IndexedDB could not be opened: the session runs in memory and nothing is saved. */
  storageUnavailable: boolean
  /** Campaigns stored in this browser, most recent first. */
  campaigns: CampaignSummary[]
  /** navigator.storage.persist() result; null until asked. */
  persisted: boolean | null
}

export const useSessionStore = create<SessionState>()(() => ({
  phase: 'starting',
  inactiveReason: 'open-elsewhere',
  failure: null,
  saveStatus: 'saved',
  saveError: null,
  storageUnavailable: false,
  campaigns: [],
  persisted: null,
}))
