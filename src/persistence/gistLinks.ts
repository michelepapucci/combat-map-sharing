import { openVttDb } from './assetBlobs'

/**
 * Device-local gist data (Decision 33): the GitHub token (only when "Remember
 * token on this device" is on) and, per local campaign, the gist it syncs with.
 * Kept in the `meta` store, never in CampaignState, so none of it travels with
 * a gist or a backup. The token is never logged or put in a URL.
 */

const TOKEN_KEY = 'gist:token'
const LINK_PREFIX = 'gist:link:'

export const AUTO_SYNC_MINUTES = [1, 2, 5, 10, 30] as const
export const DEFAULT_AUTO_SYNC_MINUTES = 2

export interface GistLink {
  gistId: string
  /** Latest commit of the gist when this device last pushed or pulled it. */
  lastSyncedSha: string | null
  /** The campaign's updatedAt at that moment: later changes are "unsynced". */
  syncedUpdatedAt: number
  autoSync: boolean
  /** Auto-sync interval in minutes. */
  intervalMin: number
}

export async function readSavedToken(): Promise<string | null> {
  const db = await openVttDb()
  const value = await db.get('meta', TOKEN_KEY)
  return typeof value === 'string' && value.length > 0 ? value : null
}

export async function saveToken(token: string): Promise<void> {
  const db = await openVttDb()
  await db.put('meta', token, TOKEN_KEY)
}

export async function forgetToken(): Promise<void> {
  const db = await openVttDb()
  await db.delete('meta', TOKEN_KEY)
}

/** A stored link, keeping only well-formed fields. */
export function parseGistLink(value: unknown): GistLink | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.gistId !== 'string' || !/^[A-Za-z0-9]{1,64}$/.test(v.gistId)) return null
  const interval =
    typeof v.intervalMin === 'number' &&
    (AUTO_SYNC_MINUTES as readonly number[]).includes(v.intervalMin)
      ? v.intervalMin
      : DEFAULT_AUTO_SYNC_MINUTES
  return {
    gistId: v.gistId,
    lastSyncedSha:
      typeof v.lastSyncedSha === 'string' && /^[0-9a-f]{1,64}$/i.test(v.lastSyncedSha)
        ? v.lastSyncedSha
        : null,
    syncedUpdatedAt:
      typeof v.syncedUpdatedAt === 'number' && Number.isFinite(v.syncedUpdatedAt)
        ? v.syncedUpdatedAt
        : 0,
    autoSync: v.autoSync === true,
    intervalMin: interval,
  }
}

export async function readGistLink(campaignId: string): Promise<GistLink | null> {
  const db = await openVttDb()
  return parseGistLink(await db.get('meta', LINK_PREFIX + campaignId))
}

export async function writeGistLink(campaignId: string, link: GistLink): Promise<void> {
  const db = await openVttDb()
  await db.put('meta', { ...link }, LINK_PREFIX + campaignId)
}

export async function removeGistLink(campaignId: string): Promise<void> {
  const db = await openVttDb()
  await db.delete('meta', LINK_PREFIX + campaignId)
}
