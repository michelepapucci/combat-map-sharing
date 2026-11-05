import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import type { CampaignState } from '../state/types'

/**
 * Local backup (SPEC §7 "Local backup"): one .zip with the campaign and the
 * blobs of its uploaded images, so it works without a network and with images
 * too large for a gist. Never holds device data (the GitHub token, gist links):
 * those are not in CampaignState. Images are stored uncompressed (they already
 * are compressed), which keeps zipping fast.
 */

export const BACKUP_CAMPAIGN_FILE = 'campaign.json'
export const BACKUP_INFO_FILE = 'backup.json'
const ASSET_DIR = 'assets/'
const APP = 'combat-map-sharing'

/** A zip may unpack to at most this much (a hostile "zip bomb" is refused before inflating). */
export const MAX_BACKUP_BYTES = 2_000_000_000
export const MAX_BACKUP_FILES = 2_000

export class BackupError extends Error {}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/** "Lost Mine 2026-11-05.vtt.zip": the name without characters file systems dislike. */
export function backupFileName(name: string, date: Date): string {
  const kept = [...name]
    .filter((char) => (char.codePointAt(0) ?? 0) >= 32 && !'\\/:*?"<>|'.includes(char))
    .join('')
  const clean = kept.trim().slice(0, 80) || 'Campaign'
  const day = date.toISOString().slice(0, 10)
  return `${clean} ${day}.vtt.zip`
}

/**
 * The backup of a campaign: its JSON and the stored blob of every uploaded image
 * in its library. Images this device does not have are listed in `missing`.
 */
export async function buildBackup(
  campaign: CampaignState,
  readAsset: (id: string) => Promise<Blob | undefined>,
  now = new Date(),
): Promise<{ zip: Uint8Array; missing: string[] }> {
  const files: Zippable = {
    [BACKUP_INFO_FILE]: strToU8(
      JSON.stringify({ app: APP, format: 1, exportedAt: now.toISOString() }, null, 2),
    ),
    [BACKUP_CAMPAIGN_FILE]: strToU8(JSON.stringify(campaign)),
  }
  const missing: string[] = []
  for (const asset of campaign.library) {
    const blob = await readAsset(asset.id)
    if (!blob) {
      missing.push(asset.id)
      continue
    }
    const ext = EXTENSIONS[asset.mime] ?? 'bin'
    files[`${ASSET_DIR}${asset.id}.${ext}`] = [
      new Uint8Array(await blob.arrayBuffer()),
      { level: 0 },
    ]
  }
  return { zip: zipSync(files, { level: 6 }), missing }
}

export interface BackupContents {
  /** Parsed campaign.json, not validated yet (migrate + validate it). */
  campaign: unknown
  /** Image bytes by asset id. */
  assets: Map<string, Uint8Array>
}

const ASSET_ENTRY = /^assets\/([A-Za-z0-9_-]{1,128})\.(png|jpg|webp|bin)$/

/** Reads a backup zip. Throws BackupError with a message for the DM. */
export function readBackup(zip: Uint8Array): BackupContents {
  let files: Record<string, Uint8Array>
  let total = 0
  let count = 0
  try {
    files = unzipSync(zip, {
      // Checked before anything is inflated: sizes are declared in the zip.
      filter: (file) => {
        count += 1
        total += file.originalSize
        if (count > MAX_BACKUP_FILES || total > MAX_BACKUP_BYTES) {
          throw new BackupError('This backup is too large to open.')
        }
        return file.name === BACKUP_CAMPAIGN_FILE || ASSET_ENTRY.test(file.name)
      },
    })
  } catch (error) {
    if (error instanceof BackupError) throw error
    throw new BackupError('This file is not a backup zip (it could not be unpacked).')
  }
  const json = files[BACKUP_CAMPAIGN_FILE]
  if (!json)
    throw new BackupError(`This zip has no ${BACKUP_CAMPAIGN_FILE}: it is not a campaign backup.`)
  let campaign: unknown
  try {
    campaign = JSON.parse(strFromU8(json))
  } catch {
    throw new BackupError(`The backup's ${BACKUP_CAMPAIGN_FILE} is damaged (not valid JSON).`)
  }
  const assets = new Map<string, Uint8Array>()
  for (const [name, bytes] of Object.entries(files)) {
    const match = ASSET_ENTRY.exec(name)
    if (match?.[1]) assets.set(match[1], bytes)
  }
  return { campaign, assets }
}
