import { isJsonObject } from '../state/migrations'
import type { CampaignState } from '../state/types'
import { openVttDb } from './assetBlobs'

/**
 * DM-side access to the `vtt` database (schema in assetBlobs.ts): campaign
 * records, device metadata and asset blobs. Campaign records are returned RAW:
 * callers must run migrateToCurrent + validateCampaign before using them.
 *
 * Asset blobs are shared between campaigns (a duplicated campaign references
 * the same blobs), so a blob is deleted only when no campaign's library lists
 * it any more.
 */

const LAST_CAMPAIGN_KEY = 'lastCampaignId'

export interface CampaignSummary {
  id: string
  name: string
  updatedAt: number
  scenes: number
}

/** Summaries of every stored campaign, most recently updated first. Tolerates broken records. */
export async function listCampaigns(): Promise<CampaignSummary[]> {
  const db = await openVttDb()
  const [keys, values] = await Promise.all([db.getAllKeys('campaigns'), db.getAll('campaigns')])
  return keys
    .map((id, i): CampaignSummary => {
      const raw = values[i]
      const record = isJsonObject(raw) ? raw : {}
      return {
        id,
        name: typeof record['name'] === 'string' ? record['name'] : 'Unreadable campaign',
        updatedAt: typeof record['updatedAt'] === 'number' ? record['updatedAt'] : 0,
        scenes: Array.isArray(record['scenes']) ? record['scenes'].length : 0,
      }
    })
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
}

/** The stored record, unvalidated. */
export async function readCampaign(id: string): Promise<unknown> {
  const db = await openVttDb()
  return db.get('campaigns', id)
}

export async function writeCampaign(campaign: CampaignState): Promise<void> {
  const db = await openVttDb()
  await db.put('campaigns', campaign, campaign.id)
}

export async function removeCampaign(id: string): Promise<void> {
  const db = await openVttDb()
  await db.delete('campaigns', id)
}

export async function getLastCampaignId(): Promise<string | null> {
  const db = await openVttDb()
  const value = await db.get('meta', LAST_CAMPAIGN_KEY)
  return typeof value === 'string' ? value : null
}

export async function setLastCampaignId(id: string): Promise<void> {
  const db = await openVttDb()
  await db.put('meta', id, LAST_CAMPAIGN_KEY)
}

// --- Asset blobs ---------------------------------------------------------------

/** Stores an imported image and its library thumbnail in one transaction. */
export async function putAsset(id: string, blob: Blob, thumbnail: Blob | null): Promise<void> {
  const db = await openVttDb()
  const tx = db.transaction(['assets', 'thumbnails'], 'readwrite')
  await Promise.all([
    tx.objectStore('assets').put(blob, id),
    thumbnail ? tx.objectStore('thumbnails').put(thumbnail, id) : Promise.resolve(),
    tx.done,
  ])
}

export async function getThumbnailBlob(id: string): Promise<Blob | undefined> {
  const db = await openVttDb()
  return db.get('thumbnails', id)
}

export async function putThumbnail(id: string, thumbnail: Blob): Promise<void> {
  const db = await openVttDb()
  await db.put('thumbnails', thumbnail, id)
}

/**
 * Deletes stored blobs (and thumbnails) that nothing references, in one
 * transaction over campaigns and assets, so an upload stored concurrently is
 * either seen by `keep` or not seen at all. References: the library of every
 * stored campaign except `openCampaignId`, whose stored record may be stale
 * (its library comes from `keep`), plus the ids `keep()` returns, evaluated
 * after reading. Returns the number of blobs deleted.
 */
export async function collectAssetGarbage(
  openCampaignId: string | null,
  keep: () => Iterable<string>,
): Promise<number> {
  const db = await openVttDb()
  const tx = db.transaction(['campaigns', 'assets', 'thumbnails'], 'readwrite')
  const campaigns = tx.objectStore('campaigns')
  const assets = tx.objectStore('assets')
  const thumbnails = tx.objectStore('thumbnails')
  const [campaignIds, records, assetKeys, thumbnailKeys] = await Promise.all([
    campaigns.getAllKeys(),
    campaigns.getAll(),
    assets.getAllKeys(),
    thumbnails.getAllKeys(),
  ])
  const referenced = new Set<string>()
  records.forEach((raw, i) => {
    if (campaignIds[i] === openCampaignId) return
    const library = isJsonObject(raw) ? raw['library'] : null
    if (!Array.isArray(library)) return
    for (const asset of library) {
      if (isJsonObject(asset) && typeof asset['id'] === 'string') referenced.add(asset['id'])
    }
  })
  for (const id of keep()) referenced.add(id)
  const orphans = assetKeys.filter((id) => !referenced.has(id))
  await Promise.all([
    ...orphans.map((id) => assets.delete(id)),
    ...thumbnailKeys.filter((id) => !referenced.has(id)).map((id) => thumbnails.delete(id)),
    tx.done,
  ])
  return orphans.length
}

export function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  )
}
