import { forgetAssetImage } from '../assets/images'
import { processImage } from '../assets/upload/imageClient'
import {
  MAX_IMAGE_EDGE,
  MAX_UPLOAD_BYTES,
  nameFromFile,
  sniffImageMime,
} from '../assets/upload/plan'
import { isQuotaError, putAsset } from '../persistence/db'
import { newId } from '../state/ids'
import type { AssetKind, AssetMeta, Id } from '../state/types'
import { getCampaign, useCampaignStore } from '../store/campaign'
import { addAssets, removeAsset } from '../store/libraryActions'
import { notify, notifySticky, useUiStore } from '../store/ui'
import { pendingUploads } from './pendingUploads'
import { collectGarbage, flushSave } from './session'
import { forgetThumbnail } from './thumbnails'
import { placeLibraryEntry } from './placement'
import type { Point } from '../geometry/types'

/**
 * Upload pipeline glue (SPEC §5.2, Decision 30): checks each file, finalizes it
 * in the image worker (downscale > 8192 px, re-encode for gist size, hash,
 * thumbnail), stores the blob in IndexedDB under a random id, then adds its
 * AssetMeta to the library. Files are processed one at a time to bound memory.
 */

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`
}

function openCampaignId(): string | null {
  return useCampaignStore.getState().campaign?.id ?? null
}

/** Imports one file into the library of campaign `campaignId` (dropped if another campaign opened meanwhile). */
async function importOne(
  file: File,
  kind: AssetKind,
  campaignId: string,
  notes: string[],
): Promise<AssetMeta | null> {
  if (file.size > MAX_UPLOAD_BYTES) {
    notes.push(`${file.name} is over ${megabytes(MAX_UPLOAD_BYTES)}.`)
    return null
  }
  const mime = sniffImageMime(new Uint8Array(await file.slice(0, 12).arrayBuffer()))
  if (!mime) {
    notes.push(`${file.name} is not a PNG, JPEG or WebP image.`)
    return null
  }
  let image
  try {
    image = await processImage(file, mime, kind)
  } catch (error) {
    notes.push(`${file.name}: ${error instanceof Error ? error.message : 'could not be read'}.`)
    return null
  }
  if (openCampaignId() !== campaignId) {
    notes.push(`${file.name} was not added: another campaign was opened meanwhile.`)
    return null
  }
  const id = newId()
  pendingUploads.add(id)
  try {
    await putAsset(id, image.blob, image.thumbnail)
    if (openCampaignId() !== campaignId) {
      pendingUploads.delete(id) // garbage collection removes the blob later
      notes.push(`${file.name} was not added: another campaign was opened meanwhile.`)
      return null
    }
  } catch (error) {
    pendingUploads.delete(id)
    notes.push(
      isQuotaError(error)
        ? `${file.name}: browser storage is full. Export a backup, then delete unused images or campaigns to make room.`
        : `${file.name} could not be stored (${error instanceof Error ? error.message : 'unknown error'}).`,
    )
    return null
  }
  const asset: AssetMeta = {
    id,
    kind,
    name: nameFromFile(file.name),
    tags: [],
    mime: image.mime,
    width: image.width,
    height: image.height,
    bytes: image.blob.size,
    hash: image.hash,
    defaultSize: kind === 'token' ? 'medium' : null,
    defaultKind: kind === 'token' ? 'enemy' : null,
    defaultCells: null,
    localOnly: image.localOnly,
    createdAt: Date.now(),
  }
  addAssets([asset])
  pendingUploads.delete(id)
  if (image.downscaled) {
    notes.push(
      `${file.name} was downscaled from ${image.originalWidth} × ${image.originalHeight} to ` +
        `${image.width} × ${image.height} px (the limit is ${MAX_IMAGE_EDGE} px).`,
    )
  }
  if (image.localOnly) {
    notes.push(
      `${file.name} is ${megabytes(image.blob.size)} even after compression: it stays on this ` +
        'device and will not sync to a gist.',
    )
  } else if (image.reencoded && !image.downscaled) {
    notes.push(`${file.name} was compressed to ${megabytes(image.blob.size)} so it can sync.`)
  }
  return asset
}

/**
 * Imports image files into the library as `kind`, one at a time, showing
 * progress. Warnings and failures stay on screen until dismissed. With
 * `review`, a single new image opens in the asset dialog so the DM can set its
 * name, tags and default size right away. Returns the new assets in order.
 */
export async function importImageFiles(
  files: readonly File[],
  kind: AssetKind,
  { review = false }: { review?: boolean } = {},
): Promise<AssetMeta[]> {
  if (files.length === 0) return []
  const campaignId = openCampaignId()
  if (campaignId === null) return []
  if (useUiStore.getState().importProgress) {
    notify('Another import is still running. Try again when it has finished.', 'warning')
    return []
  }
  const notes: string[] = []
  const added: AssetMeta[] = []
  try {
    for (const [index, file] of files.entries()) {
      useUiStore.setState({ importProgress: { done: index, total: files.length } })
      const asset = await importOne(file, kind, campaignId, notes)
      if (asset) added.push(asset)
    }
  } finally {
    useUiStore.setState({ importProgress: null })
  }
  const summary =
    added.length > 0
      ? `Added ${plural(added.length, `${kind} image`)} to the library.`
      : 'No images were added.'
  if (notes.length > 0) notifySticky([summary, ...notes])
  else notify(summary, 'success')
  const [only] = added
  if (review && added.length === 1 && only) useUiStore.setState({ editingAssetId: only.id })
  return added
}

/**
 * Deletes an uploaded asset (after the caller's confirmation): removes it from
 * the campaign, saves, then deletes its blob unless another campaign uses it.
 */
export async function deleteUploadedAsset(id: Id): Promise<void> {
  const asset = getCampaign().library.find((a) => a.id === id)
  if (!asset || !removeAsset(id)) return
  forgetAssetImage(id)
  forgetThumbnail(id)
  // Free the space first: when the disk is full, deleting images is how the DM makes room,
  // and garbage collection counts the open campaign by its in-memory library.
  await collectGarbage().catch(() => undefined)
  try {
    await flushSave()
  } catch {
    // Shown by the save indicator; autosave keeps retrying.
  }
  notify(`Deleted ${asset.name}.`)
}

/**
 * Imports files and places them as `kind` at `at` (canvas drops: maps at the
 * drop point; the first map of a scene goes to the grid origin, see placement).
 */
export async function importAndPlace(
  files: readonly File[],
  kind: AssetKind,
  at: Point | null,
  altKey = false,
): Promise<void> {
  const campaignId = openCampaignId()
  const assets = await importImageFiles(files, kind)
  if (openCampaignId() !== campaignId) return
  for (const asset of assets) placeLibraryEntry({ type: 'asset', assetId: asset.id }, at, altKey)
}
