import { findUpload, placeableImage } from '../assets/catalog'
import { fitRect } from '../geometry/camera'
import { itemBounds } from '../geometry/rect'
import type { Point } from '../geometry/types'
import type { Id } from '../state/types'
import { currentScene, placeImage, placeToken, placeUploadedToken } from '../store/actions'
import { getCampaign } from '../store/campaign'
import { useUiStore } from '../store/ui'

/** A library entry being placed: a built-in token preset, or an asset (built-in map/prop or upload). */
export type LibraryEntry = { type: 'preset'; presetId: string } | { type: 'asset'; assetId: string }

/** dataTransfer type for dragging library entries onto the canvas. */
export const LIBRARY_MIME = 'application/x-vtt-library-entry'

export function parseLibraryEntry(json: string): LibraryEntry | null {
  try {
    const value: unknown = JSON.parse(json)
    if (typeof value !== 'object' || value === null) return null
    const { type, presetId, assetId } = value as Record<string, unknown>
    if (type === 'preset' && typeof presetId === 'string') return { type, presetId }
    if (type === 'asset' && typeof assetId === 'string') return { type, assetId }
  } catch {
    // Not ours.
  }
  return null
}

/**
 * Places a map at native size. The first map of a scene (clicked or dropped)
 * goes to the grid origin, so it lines up with the default grid, and the view
 * fits it; later maps are centered on the drop point or the view.
 */
function placeMap(assetId: string, at: Point | null, snap: boolean): Id | null {
  const asset = placeableImage(getCampaign().library, assetId)
  if (!asset) return null
  const { dmCamera, dmViewport } = useUiStore.getState()
  const scene = currentScene()
  const firstMap = scene.layers.map.length === 0
  const point = at ?? { x: dmCamera.x, y: dmCamera.y }
  const topLeft = firstMap
    ? { x: scene.grid.offsetX, y: scene.grid.offsetY }
    : { x: point.x - asset.width / 2, y: point.y - asset.height / 2 }
  const id = placeImage(asset.id, topLeft, { snap, anchor: 'top-left' })
  const placed = id ? currentScene().layers.map.find((item) => item.id === id) : undefined
  if (firstMap && placed && dmViewport.width > 0) {
    useUiStore.setState({ dmCamera: fitRect(itemBounds(placed), dmViewport) })
  }
  return id
}

/**
 * Places a library entry at a world point (a drop), or, with `at: null` (a click
 * in the library), at the center of the view. Returns the new item's id.
 */
export function placeLibraryEntry(
  entry: LibraryEntry,
  at: Point | null,
  altKey = false,
): Id | null {
  const snap = getCampaign().settings.snapEnabled && !altKey
  const { dmCamera } = useUiStore.getState()
  const center = { x: dmCamera.x, y: dmCamera.y }
  if (entry.type === 'preset') return placeToken(entry.presetId, at ?? center, { snap })
  const upload = findUpload(getCampaign().library, entry.assetId)
  if (upload?.kind === 'token') return placeUploadedToken(upload.id, at ?? center, { snap })
  const asset = placeableImage(getCampaign().library, entry.assetId)
  if (!asset) return null
  if (asset.kind === 'map') return placeMap(asset.id, at, snap)
  return placeImage(asset.id, at ?? center, { snap })
}
