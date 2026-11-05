/**
 * Image import worker. Decoding, downscaling, re-encoding and hashing an 8k map
 * takes seconds; doing it here keeps the DM window (and the player window, which
 * shares its event loop) responsive. See plan.ts for the rules.
 */
import type { AssetKind } from '../../state/types'
import {
  chooseEncoding,
  fitWithin,
  MAX_IMAGE_EDGE,
  THUMBNAIL_EDGE,
  toHex,
  type ImageMime,
} from './plan'

export type ImageJob =
  | { id: number; type: 'import'; file: Blob; mime: ImageMime; kind: AssetKind }
  | { id: number; type: 'thumbnail'; blob: Blob }

export interface ImportedImage {
  blob: Blob
  mime: ImageMime
  width: number
  height: number
  /** SHA-256 hex of `blob`. */
  hash: string
  thumbnail: Blob
  originalWidth: number
  originalHeight: number
  downscaled: boolean
  reencoded: boolean
  localOnly: boolean
}

export type ImageJobResult =
  | { id: number; ok: true; image: ImportedImage }
  | { id: number; ok: true; thumbnail: Blob }
  | { id: number; ok: false; error: string }

/** A high-quality resize (createImageBitmap's resampler), drawn onto a canvas of exactly that size. */
async function resized(source: ImageBitmap, width: number, height: number) {
  const bitmap =
    width === source.width && height === source.height
      ? source
      : await createImageBitmap(source, {
          resizeWidth: width,
          resizeHeight: height,
          resizeQuality: 'high',
        })
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot draw images off the main thread.')
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, width, height)
  if (bitmap !== source) bitmap.close()
  return canvas
}

async function thumbnailOf(bitmap: ImageBitmap): Promise<Blob> {
  const size = fitWithin(bitmap.width, bitmap.height, THUMBNAIL_EDGE)
  const canvas = await resized(bitmap, size.width, size.height)
  // Browsers without a WebP encoder return PNG, which is fine for a thumbnail.
  return canvas.convertToBlob({ type: 'image/webp', quality: 0.8 })
}

async function decode(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('the image could not be decoded (damaged, or too large for this browser)')
  }
}

async function importImage(file: Blob, mime: ImageMime, kind: AssetKind): Promise<ImportedImage> {
  const bitmap = await decode(file)
  try {
    const target = fitWithin(bitmap.width, bitmap.height, MAX_IMAGE_EDGE)
    const downscaled = target.width !== bitmap.width || target.height !== bitmap.height
    let canvas: OffscreenCanvas | null = null
    const choice = await chooseEncoding(
      { originalBytes: file.size, mustEncode: downscaled, kind },
      async (type, quality) => {
        canvas ??= await resized(bitmap, target.width, target.height)
        return canvas.convertToBlob({ type, quality })
      },
    )
    const blob = choice.blob ?? file
    const finalMime = (choice.blob?.type ?? mime) as ImageMime
    const [hash, thumbnail] = await Promise.all([
      crypto.subtle.digest('SHA-256', await blob.arrayBuffer()).then(toHex),
      thumbnailOf(bitmap),
    ])
    return {
      blob,
      mime: finalMime,
      width: target.width,
      height: target.height,
      hash,
      thumbnail,
      originalWidth: bitmap.width,
      originalHeight: bitmap.height,
      downscaled,
      reencoded: choice.blob !== null,
      localOnly: choice.localOnly,
    }
  } finally {
    bitmap.close()
  }
}

async function handle(job: ImageJob): Promise<ImageJobResult> {
  if (job.type === 'import') {
    return { id: job.id, ok: true, image: await importImage(job.file, job.mime, job.kind) }
  }
  const bitmap = await decode(job.blob)
  try {
    return { id: job.id, ok: true, thumbnail: await thumbnailOf(bitmap) }
  } finally {
    bitmap.close()
  }
}

/** Replies to the page (a worker's postMessage has no target origin). */
function reply(result: ImageJobResult): void {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- worker scope, no target origin
  self.postMessage(result)
}

self.addEventListener('message', (event: MessageEvent<ImageJob>) => {
  const job = event.data
  handle(job).then(reply, (error: unknown) =>
    reply({ id: job.id, ok: false, error: error instanceof Error ? error.message : String(error) }),
  )
})
