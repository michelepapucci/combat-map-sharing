import { create } from 'zustand'
import type { GistLink } from '../persistence/gistLinks'

/**
 * Gist sync state of the DM window (SPEC §7 "Status indicator"). The token lives
 * here in memory (and in IndexedDB only when remembered); it is never logged,
 * shown, or put in a URL.
 */
export type GistStatus =
  /** No token: sync is off. */
  | 'off'
  /** Token, but this campaign has no gist yet. */
  | 'unlinked'
  | 'synced'
  | 'unsynced'
  | 'syncing'
  | 'error'
  /** The gist changed elsewhere since this device synced it: the DM must choose. */
  | 'conflict'

export interface GistState {
  token: string | null
  /** The GitHub account the token belongs to. */
  login: string | null
  remember: boolean
  /** The open campaign's gist, if any. */
  link: GistLink | null
  status: GistStatus
  /** Last error, for the DM (GitHub's message, never the token). */
  error: string | null
  rateLimit: { remaining: number; resetAt: number } | null
  progress: { phase: 'checking' | 'assets' | 'campaign'; done: number; total: number } | null
}

export function initialGistState(): GistState {
  return {
    token: null,
    login: null,
    remember: true,
    link: null,
    status: 'off',
    error: null,
    rateLimit: null,
    progress: null,
  }
}

export const useGistStore = create<GistState>()(() => initialGistState())
