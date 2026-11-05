import type { AssetMeta } from '../state/types'
import { getBuiltinImageAsset, isBuiltinId } from './builtin/registry'
import { defaultCellsFor } from './upload/plan'

/**
 * One view over built-in and uploaded assets, for placing items. Uploaded assets
 * live in the campaign library (their blobs in IndexedDB), built-in ones in the
 * code registry.
 */

/** A map or prop that can be placed: native size in px, and the default footprint of props. */
export interface PlaceableImage {
  id: string
  kind: 'prop' | 'map'
  name: string
  width: number
  height: number
  /** Props: footprint in cells. Maps: null (placed at native size). */
  cells: { w: number; h: number } | null
}

export function findUpload(library: readonly AssetMeta[], id: string): AssetMeta | undefined {
  return isBuiltinId(id) ? undefined : library.find((asset) => asset.id === id)
}

export function placeableImage(
  library: readonly AssetMeta[],
  id: string,
): PlaceableImage | undefined {
  const builtin = getBuiltinImageAsset(id)
  if (builtin) return builtin
  const asset = findUpload(library, id)
  if (!asset || asset.kind === 'token') return undefined
  return {
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    width: asset.width,
    height: asset.height,
    cells:
      asset.kind === 'prop'
        ? (asset.defaultCells ?? defaultCellsFor(asset.width, asset.height))
        : null,
  }
}
