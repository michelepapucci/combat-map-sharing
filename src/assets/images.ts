import { getBuiltinImageAsset } from './builtin/registry'
import { svgDataUrl } from './builtin/svg'

/**
 * Decoded images for canvas rendering, shared by the DM and player windows.
 * Built-in SVGs are rasterized once into a canvas at their native size, so Konva
 * never re-rasterizes an SVG while panning. Uploaded assets (IndexedDB blobs)
 * arrive in milestone 3.
 */
export type AssetImage = HTMLCanvasElement | HTMLImageElement

const pending = new Map<string, Promise<AssetImage>>()
const ready = new Map<string, AssetImage>()

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

/** The decoded image if it has already loaded (lets components render it without a flash). */
export function peekAssetImage(assetId: string): AssetImage | undefined {
  return ready.get(assetId)
}

/** Loads (once) and returns the image of a map or prop asset. */
export function loadAssetImage(assetId: string): Promise<AssetImage> {
  let promise = pending.get(assetId)
  if (promise === undefined) {
    const asset = getBuiltinImageAsset(assetId)
    promise = asset
      ? rasterize(asset.svg(), asset.width, asset.height)
      : Promise.reject(new Error(`Unknown image asset: ${assetId}`))
    promise.then(
      (image) => ready.set(assetId, image),
      () => pending.delete(assetId),
    )
    pending.set(assetId, promise)
  }
  return promise
}
