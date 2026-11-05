import { getAssetBlob } from '../persistence/assetBlobs'
import { getBuiltinImageAsset, isBuiltinId } from './builtin/registry'
import { svgDataUrl } from './builtin/svg'

/**
 * Decoded images for canvas rendering, shared by the DM and player windows.
 * Built-in SVGs are rasterized once into a canvas at their native size, so Konva
 * never re-rasterizes an SVG while panning. Uploaded images are read from
 * IndexedDB by id (persistence/assetBlobs) and decoded once into an ImageBitmap,
 * which stays decoded (an <img> may be discarded and re-decoded mid-pan).
 * An asset's blob never changes after import, so the cache never goes stale.
 */
export type AssetImage = HTMLCanvasElement | HTMLImageElement | ImageBitmap

/**
 * Decoded pixels kept for images that no component shows (64 Mpx, about 256 MB
 * RGBA: one 8k map). Images on screen are never evicted; idle ones are dropped
 * least recently used first, so switching scenes and campaigns cannot pile up
 * decoded 8k maps until the tab crashes.
 */
export const IDLE_PIXEL_BUDGET = 64 * 1024 * 1024

interface Entry {
  image: AssetImage
  pixels: number
  lastUsed: number
}

const pending = new Map<string, Promise<AssetImage>>()
const ready = new Map<string, Entry>()
/** Mounted components showing each image (useAssetImage). */
const refs = new Map<string, number>()
let clock = 0

function pixelsOf(image: AssetImage): number {
  return image instanceof HTMLImageElement
    ? image.naturalWidth * image.naturalHeight
    : image.width * image.height
}

function drop(assetId: string): void {
  const entry = ready.get(assetId)
  ready.delete(assetId)
  pending.delete(assetId)
  // Only idle bitmaps are closed: a bitmap still drawn by a node must stay valid.
  if (entry?.image instanceof ImageBitmap && !refs.get(assetId)) entry.image.close()
}

let trimScheduled = false

/**
 * Trims after the current task, so a component that releases an image and one
 * that shows it again in the same render (a scene switch) never see it closed.
 */
function scheduleTrim(): void {
  if (trimScheduled) return
  trimScheduled = true
  setTimeout(() => {
    trimScheduled = false
    trim()
  }, 0)
}

/** Evicts idle images, least recently used first, until they fit IDLE_PIXEL_BUDGET. */
function trim(): void {
  const idle = [...ready].filter(([id]) => !refs.get(id))
  let total = idle.reduce((sum, [, entry]) => sum + entry.pixels, 0)
  idle.sort(([, a], [, b]) => a.lastUsed - b.lastUsed)
  for (const [id, entry] of idle) {
    if (total <= IDLE_PIXEL_BUDGET) break
    total -= entry.pixels
    drop(id)
  }
}

async function rasterize(svg: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const image = new Image(width, height)
  image.src = svgDataUrl(svg)
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context unavailable')
  context.drawImage(image, 0, 0, width, height)
  return canvas
}

async function decodeUpload(assetId: string): Promise<ImageBitmap> {
  const blob = await getAssetBlob(assetId)
  if (!blob) throw new Error(`Image ${assetId} is not stored on this device`)
  return createImageBitmap(blob, { imageOrientation: 'from-image' })
}

/** The decoded image if it has already loaded (lets components render it without a flash). */
export function peekAssetImage(assetId: string): AssetImage | undefined {
  const entry = ready.get(assetId)
  if (entry) entry.lastUsed = ++clock
  return entry?.image
}

/** Loads (once) and returns the image of a map, prop or uploaded token asset. */
export function loadAssetImage(assetId: string): Promise<AssetImage> {
  const cached = ready.get(assetId)
  if (cached) return Promise.resolve(cached.image)
  let promise = pending.get(assetId)
  if (promise === undefined) {
    const builtin = getBuiltinImageAsset(assetId)
    const loading: Promise<AssetImage> = builtin
      ? rasterize(builtin.svg(), builtin.width, builtin.height)
      : isBuiltinId(assetId)
        ? Promise.reject(new Error(`Unknown image asset: ${assetId}`))
        : decodeUpload(assetId)
    loading.then(
      (image) => {
        // Forgotten (asset deleted) while decoding: discard the result.
        if (pending.get(assetId) !== loading) {
          if (image instanceof ImageBitmap) image.close()
          return
        }
        pending.delete(assetId)
        ready.set(assetId, { image, pixels: pixelsOf(image), lastUsed: ++clock })
        scheduleTrim()
      },
      () => {
        if (pending.get(assetId) === loading) pending.delete(assetId)
      },
    )
    promise = loading
    pending.set(assetId, promise)
  }
  return promise
}

/** Marks an image as shown by a component; call the returned function when it stops. */
export function retainAssetImage(assetId: string): () => void {
  refs.set(assetId, (refs.get(assetId) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const count = (refs.get(assetId) ?? 1) - 1
    if (count > 0) refs.set(assetId, count)
    else refs.delete(assetId)
    const entry = ready.get(assetId)
    if (entry) entry.lastUsed = ++clock
    scheduleTrim()
  }
}

/** Drops a deleted asset's decoded image (and any decode in flight). */
export function forgetAssetImage(assetId: string): void {
  drop(assetId)
}
