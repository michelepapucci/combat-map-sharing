import { getBuiltinImageAsset } from '../assets/builtin/registry'
import { fitRect } from '../geometry/camera'
import { itemBounds } from '../geometry/rect'
import type { Point } from '../geometry/types'
import { currentScene, placeImage, placeToken } from '../store/actions'
import { getCampaign } from '../store/campaign'
import { useUiStore } from '../store/ui'

/** A library entry being placed: a token preset or a map/prop asset. */
export type LibraryEntry = { type: 'token'; presetId: string } | { type: 'image'; assetId: string }

/** dataTransfer type for dragging library entries onto the canvas. */
export const LIBRARY_MIME = 'application/x-vtt-library-entry'

export function parseLibraryEntry(json: string): LibraryEntry | null {
  try {
    const value: unknown = JSON.parse(json)
    if (typeof value !== 'object' || value === null) return null
    const { type, presetId, assetId } = value as Record<string, unknown>
    if (type === 'token' && typeof presetId === 'string') return { type, presetId }
    if (type === 'image' && typeof assetId === 'string') return { type, assetId }
  } catch {
    // Not ours.
  }
  return null
}

/**
 * Places a library entry at a world point (a drop), or, with `at: null` (a click
 * in the library), at the center of the view. The first map placed in an empty
 * map layer by click goes to the grid origin and the view fits it.
 */
export function placeLibraryEntry(entry: LibraryEntry, at: Point | null, altKey = false): void {
  const snap = getCampaign().settings.snapEnabled && !altKey
  const { dmCamera, dmViewport } = useUiStore.getState()
  const center = { x: dmCamera.x, y: dmCamera.y }
  if (entry.type === 'token') {
    placeToken(entry.presetId, at ?? center, { snap })
    return
  }
  const asset = getBuiltinImageAsset(entry.assetId)
  if (!asset) return
  if (asset.kind === 'prop') {
    placeImage(asset.id, at ?? center, { snap })
    return
  }
  const scene = currentScene()
  const firstMap = at === null && scene.layers.map.length === 0
  const point = at ?? center
  const topLeft = firstMap
    ? { x: scene.grid.offsetX, y: scene.grid.offsetY }
    : { x: point.x - asset.width / 2, y: point.y - asset.height / 2 }
  const id = placeImage(asset.id, topLeft, { snap, anchor: 'top-left' })
  const placed = id ? currentScene().layers.map.find((item) => item.id === id) : undefined
  if (firstMap && placed && dmViewport.width > 0) {
    useUiStore.setState({ dmCamera: fitRect(itemBounds(placed), dmViewport) })
  }
}
