import { findUpload } from '../assets/catalog'
import { LAYER_NAMES, type AssetMeta, type Id } from '../state/types'
import { clearHistory, getCampaign, setUnrecorded, useCampaignStore } from './campaign'
import { useUiStore } from './ui'

/**
 * Uploaded-asset library actions (SPEC §5.2). The library is not undoable
 * (Decision 18's split: only `scenes` and `name` are recorded). Blob storage is
 * the DM session's job (src/dm/uploads.ts); these only change the campaign.
 */

export const MAX_ASSET_NAME = 200
export const MAX_TAGS = 20

export type AssetPatch = Partial<
  Pick<AssetMeta, 'name' | 'tags' | 'kind' | 'defaultSize' | 'defaultKind' | 'defaultCells'>
>

/** Tags from free text: comma-separated, trimmed, lowercased, unique. */
export function parseTags(text: string): string[] {
  const tags = text
    .split(',')
    .map((tag) => tag.trim().toLowerCase().slice(0, 64))
    .filter((tag) => tag !== '')
  return [...new Set(tags)].slice(0, MAX_TAGS)
}

export function addAssets(assets: readonly AssetMeta[]): void {
  setUnrecorded((draft) => {
    for (const asset of assets) draft.library.push(asset)
  })
}

export function updateAsset(id: Id, patch: AssetPatch): void {
  setUnrecorded((draft) => {
    const asset = draft.library.find((a) => a.id === id)
    if (!asset) return
    if (patch.name !== undefined) {
      const name = patch.name.trim().slice(0, MAX_ASSET_NAME)
      if (name !== '') asset.name = name
    }
    if (patch.tags !== undefined) asset.tags = patch.tags.slice(0, MAX_TAGS)
    if (patch.kind !== undefined) asset.kind = patch.kind
    if (patch.defaultSize !== undefined) asset.defaultSize = patch.defaultSize
    if (patch.defaultKind !== undefined) asset.defaultKind = patch.defaultKind
    if (patch.defaultCells !== undefined) asset.defaultCells = patch.defaultCells
    // Defaults only make sense for their kind.
    if (asset.kind !== 'token') {
      asset.defaultSize = null
      asset.defaultKind = null
    }
    if (asset.kind !== 'prop') asset.defaultCells = null
  })
}

export interface AssetUsage {
  /** Items placed from this asset, over all scenes. */
  items: number
  scenes: number
  /** It is the blackout splash image. */
  splash: boolean
  /** Undo/redo could bring back items that use it. */
  inHistory: boolean
}

export function assetUsage(id: Id): AssetUsage {
  const campaign = getCampaign()
  let items = 0
  let scenes = 0
  for (const scene of campaign.scenes) {
    const count = LAYER_NAMES.reduce(
      (sum, layer) => sum + scene.layers[layer].filter((item) => item.assetId === id).length,
      0,
    )
    items += count
    if (count > 0) scenes++
  }
  const { past, future } = useCampaignStore.getState()
  return {
    items,
    scenes,
    splash: campaign.presentation.splashAssetId === id,
    inHistory: JSON.stringify([past, future]).includes(JSON.stringify(id)),
  }
}

/**
 * Removes an asset from the campaign: its library entry, every item placed from
 * it, and the splash image if it was one. The blob cannot come back, so when
 * items were removed or the history mentions the asset, the history is cleared.
 * Returns false if the asset is not in the library.
 */
export function removeAsset(id: Id): boolean {
  if (!findUpload(getCampaign().library, id)) return false
  const usage = assetUsage(id)
  setUnrecorded((draft) => {
    draft.library = draft.library.filter((asset) => asset.id !== id)
    const uses = (item: { assetId: Id }) => item.assetId === id
    for (const { layers } of draft.scenes) {
      if (layers.map.some(uses)) layers.map = layers.map.filter((item) => !uses(item))
      if (layers.props.some(uses)) layers.props = layers.props.filter((item) => !uses(item))
      if (layers.tokens.some(uses)) layers.tokens = layers.tokens.filter((item) => !uses(item))
    }
    if (draft.presentation.splashAssetId === id) draft.presentation.splashAssetId = null
  })
  if (usage.items > 0 || usage.inHistory) clearHistory()
  const { clipboard } = useUiStore.getState()
  if (clipboard?.some((entry) => entry.item.assetId === id)) {
    const kept = clipboard.filter((entry) => entry.item.assetId !== id)
    useUiStore.setState({ clipboard: kept.length > 0 ? kept : null })
  }
  return true
}
