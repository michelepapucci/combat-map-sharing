import { getAssetBlob } from '../persistence/assetBlobs'
import { BackupError, backupFileName, buildBackup, readBackup } from '../persistence/backup'
import { putAsset } from '../persistence/db'
import { newId } from '../state/ids'
import { migrateToCurrent } from '../state/migrations'
import type { CampaignState } from '../state/types'
import { MAX_NAME_LENGTH, validateCampaign } from '../state/validate'
import { getCampaign } from '../store/campaign'
import { useSessionStore } from '../store/session'
import { notify, notifySticky } from '../store/ui'
import { chooseAction } from './confirm'
import { markReplaced } from './gist'
import { pendingUploads } from './pendingUploads'
import { adoptCampaign, flushSave } from './session'

/**
 * Local backups (SPEC §7): export the open campaign with its images as a .zip,
 * and import one back (replacing the campaign with the same id, or as a copy).
 */

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  // The download has started by then; the URL is only needed until it has.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** fflate's arrays are backed by plain ArrayBuffers; Blob and crypto want to know it. */
function plain(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer
    ? (bytes as Uint8Array<ArrayBuffer>)
    : new Uint8Array(bytes)
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', plain(bytes))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Downloads a .zip of the open campaign and its images. */
export async function exportBackup(): Promise<void> {
  await flushSave().catch(() => undefined) // the backup is built from memory anyway
  const campaign = getCampaign()
  try {
    const { zip, missing } = await buildBackup(campaign, getAssetBlob)
    download(
      new Blob([plain(zip)], { type: 'application/zip' }),
      backupFileName(campaign.name, new Date()),
    )
    if (missing.length > 0) {
      notifySticky([
        `Backup saved, without ${missing.length} ${missing.length === 1 ? 'image' : 'images'} this device does not have.`,
      ])
    } else {
      notify('Backup saved to your downloads.')
    }
  } catch (error) {
    notifySticky([`The backup could not be made: ${errorText(error)}`])
  }
}

/** Restores a backup .zip: its images, then the campaign, which then opens. */
export async function importBackup(file: File): Promise<void> {
  let campaign: CampaignState
  let images: Map<string, Uint8Array>
  try {
    const contents = readBackup(new Uint8Array(await file.arrayBuffer()))
    campaign = validateCampaign(migrateToCurrent(contents.campaign)).campaign
    images = contents.assets
  } catch (error) {
    const reason =
      error instanceof BackupError ? error.message : `It could not be read: ${errorText(error)}`
    notifySticky([`“${file.name}” was not imported. ${reason}`])
    return
  }

  const existing = useSessionStore.getState().campaigns.find((c) => c.id === campaign.id)
  if (existing) {
    const choice = await chooseAction({
      title: `“${existing.name}” is already on this device`,
      message:
        'Replace it with the backup, or keep both by importing the backup as a copy? Replacing cannot be undone.',
      choices: [
        { id: 'copy', label: 'Import as a copy', tone: 'plain' },
        { id: 'replace', label: 'Replace', tone: 'danger' },
      ],
    })
    if (choice === null) return
    if (choice === 'copy') {
      const now = Date.now()
      campaign = {
        ...campaign,
        id: newId(),
        name: `${campaign.name} (restored)`.slice(0, MAX_NAME_LENGTH),
        createdAt: now,
        updatedAt: now,
      }
    }
  }

  // Images first: the stored campaign never lists an image the backup had but the device lacks.
  // Until the campaign is stored they are pending, so garbage collection keeps them.
  const missing: string[] = []
  const written: string[] = []
  const replacing = existing !== undefined && campaign.id === existing.id
  try {
    for (const asset of campaign.library) {
      const bytes = images.get(asset.id)
      // Each image must be exactly the one the campaign describes.
      if (!bytes || (await sha256Hex(bytes)) !== asset.hash) {
        missing.push(asset.id)
        continue
      }
      pendingUploads.add(asset.id)
      written.push(asset.id)
      await putAsset(asset.id, new Blob([plain(bytes)], { type: asset.mime }), null)
    }
  } catch (error) {
    for (const id of written) pendingUploads.delete(id)
    notifySticky([`The backup's images could not be stored: ${errorText(error)}`])
    return
  }
  const adopted = await adoptCampaign(campaign)
  for (const id of written) pendingUploads.delete(id)
  if (!adopted) return
  // A linked campaign replaced by an older backup now differs from its gist.
  if (replacing) await markReplaced(campaign.id)
  if (missing.length > 0) {
    notifySticky([
      `Imported “${campaign.name}”, but ${missing.length} ${missing.length === 1 ? 'image was' : 'images were'} missing or damaged in the backup.`,
    ])
  } else {
    notify(`Imported “${campaign.name}”.`)
  }
}
