import { describe, expect, it } from 'vitest'
import { MAP_ASSETS, PROP_ASSETS, TOKEN_COLORS, TOKEN_PRESETS } from '../assets/builtin/registry'
import { createCampaign } from '../state/defaults'
import { migrateToCurrent } from '../state/migrations'
import { allItems } from '../state/sceneOps'
import {
  SIZE_CATEGORIES,
  TOKEN_KINDS,
  type AssetMeta,
  type CampaignState,
  type Id,
} from '../state/types'
import { validateCampaign } from '../state/validate'
import {
  calibrateGrid,
  copyItems,
  currentScene,
  deleteItems,
  duplicateItems,
  moveItems,
  nudgeItems,
  pasteItems,
  placeImage,
  placeToken,
  placeUploadedToken,
  redoAction,
  reorderItems,
  setLayerState,
  toggleHidden,
  toggleLocked,
  transformItems,
  undoAction,
  updateGrid,
  updateItem,
} from './actions'
import { getCampaign, loadCampaign } from './campaign'
import { addAssets, removeAsset, updateAsset } from './libraryActions'
import {
  addScene,
  deleteScene,
  duplicateScene,
  moveScene,
  renameScene,
  switchScene,
} from './sceneActions'
import { initialUiState, useUiStore } from './ui'

/**
 * Whatever the editor does, the campaign it saves must load again unchanged:
 * validateCampaign may neither reject it (that would lock the DM out) nor need
 * to repair it. Random action sequences with hostile but UI-reachable inputs.
 */

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function itemIds(): Id[] {
  return allItems(currentScene()).map(({ item }) => item.id)
}

function run(seed: number, steps: number): void {
  const r = mulberry32(seed)
  const pick = <T>(values: readonly T[]): T => {
    const value = values[Math.floor(r() * values.length)]
    if (value === undefined) throw new Error('empty')
    return value
  }
  const num = (min: number, max: number) => min + r() * (max - min)
  const point = () => ({ x: num(-3000, 3000), y: num(-3000, 3000) })
  const longText = () => 'Ж😀x '.repeat(Math.floor(num(0, 90)))
  const name = () => (r() < 0.3 ? longText() : pick(['Goblin', 'Orc 7', '', '  Boss  ', 'A']))
  const someIds = (): Id[] => itemIds().filter(() => r() < 0.4)
  const uploads: AssetMeta[] = []
  let uploadCount = 0

  const actions: (() => void)[] = [
    () => placeToken(pick(TOKEN_PRESETS).id, point(), { snap: r() < 0.5 }),
    () => placeImage(pick(PROP_ASSETS).id, point(), { snap: r() < 0.5 }),
    () => placeImage(pick(MAP_ASSETS).id, point(), { snap: r() < 0.5, anchor: 'top-left' }),
    () => {
      uploadCount += 1
      const asset: AssetMeta = {
        id: `upload-${uploadCount}`,
        kind: pick(['token', 'prop', 'map'] as const),
        name: name().slice(0, 200) || 'Image',
        tags: [],
        mime: 'image/webp',
        width: Math.ceil(num(1, 8192)),
        height: Math.ceil(num(1, 8192)),
        bytes: 1000,
        hash: 'f'.repeat(64),
        defaultSize: null,
        defaultKind: null,
        defaultCells: null,
        localOnly: false,
        createdAt: 1,
      }
      uploads.push(asset)
      addAssets([asset])
    },
    () => {
      const asset = uploads.length > 0 ? pick(uploads) : null
      if (!asset) return
      placeUploadedToken(asset.id, point(), { snap: true })
      placeImage(asset.id, point(), { snap: r() < 0.5 })
    },
    () => {
      const asset = uploads.length > 0 ? pick(uploads) : null
      if (asset) updateAsset(asset.id, { name: longText(), tags: [longText().slice(0, 64)] })
    },
    () => {
      const asset = uploads.length > 0 ? pick(uploads) : null
      if (asset) removeAsset(asset.id)
    },
    () => {
      const ids = itemIds()
      if (ids.length === 0) return
      updateItem(pick(ids), {
        name: name(),
        rotation: num(-1000, 1000),
        opacity: num(-1, 2),
        kind: pick(TOKEN_KINDS),
        sizeCategory: pick(SIZE_CATEGORIES),
        color: pick(TOKEN_COLORS).value,
        badge: pick([null, 'A', 'OC2', '7']),
      })
    },
    () => moveItems(Object.fromEntries(someIds().map((id) => [id, point()]))),
    () =>
      transformItems(
        Object.fromEntries(
          someIds().map((id) => [
            id,
            { ...point(), width: num(-5, 900), height: num(-5, 900), rotation: num(-720, 720) },
          ]),
        ),
      ),
    () => nudgeItems(someIds(), pick([-70, 0, 1, 70]), pick([-1, 0, 70])),
    () => duplicateItems(someIds()),
    () => {
      copyItems(someIds())
      pasteItems(r() < 0.5 ? point() : null)
    },
    () => deleteItems(someIds()),
    () => toggleHidden(someIds()),
    () => toggleLocked(someIds()),
    () => reorderItems(someIds(), pick(['forward', 'backward'] as const)),
    () =>
      updateGrid({
        size: num(-10, 3000),
        offsetX: num(-500, 500),
        offsetY: num(-500, 500),
        opacity: num(-1, 2),
        feetPerCell: Math.round(num(1, 30)),
        color: pick(TOKEN_COLORS).value,
      }),
    () =>
      calibrateGrid(
        { x: num(-100, 100), y: num(-100, 100), width: num(0, 900), height: num(0, 900) },
        Math.ceil(num(0, 50)),
      ),
    () =>
      setLayerState(pick(['map', 'props', 'tokens'] as const), {
        locked: r() < 0.5,
        visible: r() < 0.7,
      }),
    () => addScene(),
    () => duplicateScene(getCampaign().activeSceneId),
    () => deleteScene(pick(getCampaign().scenes).id),
    () => moveScene(pick(getCampaign().scenes).id, pick([-1, 1] as const)),
    () => renameScene(pick(getCampaign().scenes).id, name()),
    () => switchScene(pick(getCampaign().scenes).id),
    () => undoAction(),
    () => undoAction(),
    () => redoAction(),
  ]
  for (let step = 0; step < steps; step++) pick(actions)()
}

describe('the editor never saves a campaign it cannot load', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('random session %i', (seed) => {
    loadCampaign(createCampaign('Fuzz'))
    useUiStore.setState(initialUiState())
    run(seed, 400)
    const saved = JSON.parse(JSON.stringify(getCampaign())) as CampaignState
    const { campaign, repairs } = validateCampaign(migrateToCurrent(saved))
    // The only expected repair: memory of deleted scenes, kept for undo, is dropped (Decision 50).
    const live = new Set(saved.scenes.map((scene) => scene.id))
    const orphans = Object.keys(saved.sceneMemory).filter((id) => !live.has(id))
    expect(repairs).toStrictEqual(
      orphans.map((id) => `sceneMemory[${JSON.stringify(id)}]: dropped memory of a deleted scene`),
    )
    for (const id of orphans) delete saved.sceneMemory[id]
    expect(campaign).toStrictEqual(saved)
  })
})
