import { describe, expect, it } from 'vitest'
import { recordExplored, resetExploredTracking } from '../dm/explored'
import { MAP_ASSETS, PROP_ASSETS, TOKEN_COLORS, TOKEN_PRESETS } from '../assets/builtin/registry'
import { createCampaign } from '../state/defaults'
import { migrateToCurrent } from '../state/migrations'
import { allItems } from '../state/sceneOps'
import {
  SIZE_CATEGORIES,
  TOKEN_KINDS,
  type AssetMeta,
  type FogShape,
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
import { getCampaign, loadCampaign, setUnrecorded, useCampaignStore } from './campaign'
import { addFogEdit, clearFogEdits, resetExplored, setNpcVision, setSceneFog } from './fogActions'
import {
  addNamedEntry,
  addTokensToInitiative,
  endCombat,
  moveAmongTies,
  nextTurn,
  previousTurn,
  removeEntry,
  rollInitiative,
  setTrackerVisible,
  toggleEntryVisibility,
  updateEntry,
} from './initiativeActions'
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

function entryIds(): Id[] {
  return currentScene().initiative.entries.map((entry) => entry.id)
}

function tokenIds(): Id[] {
  return currentScene().layers.tokens.map((token) => token.id)
}

function itemIds(): Id[] {
  return allItems(currentScene()).map(({ item }) => item.id)
}

function run(seed: number, steps: number, focus: 'all' | 'fog'): void {
  const r = mulberry32(seed)
  const pick = <T>(values: readonly T[]): T => {
    const value = values[Math.floor(r() * values.length)]
    if (value === undefined) throw new Error('empty')
    return value
  }
  const num = (min: number, max: number) => min + r() * (max - min)
  // Mostly near the origin, sometimes absurdly far (fog chunk coordinates have limits).
  const coordinate = () => (r() < 0.03 ? num(-1e9, 1e9) : num(-3000, 3000))
  const point = () => ({ x: coordinate(), y: coordinate() })
  const longText = () => 'Ж😀x '.repeat(Math.floor(num(0, 90)))
  const name = () => (r() < 0.3 ? longText() : pick(['Goblin', 'Orc 7', '', '  Boss  ', 'A']))
  const someIds = (): Id[] => itemIds().filter(() => r() < 0.4)
  const uploads: AssetMeta[] = []
  let uploadCount = 0

  // Token properties, vision and fog (milestone 5).
  const fogActions: (() => void)[] = [
    () => {
      const id = placeToken(pick(['hero', 'ally', 'goblin']), point(), { snap: r() < 0.5 })
      if (id) updateItem(id, { visionFt: pick([30, 60, 120]) })
    },
    () => {
      const ids = tokenIds().filter(() => r() < 0.5)
      moveItems(Object.fromEntries(ids.map((id) => [id, r() < 0.5 ? point() : { x: 0, y: 0 }])))
    },
    () => {
      const ids = tokenIds()
      if (ids.length === 0) return
      updateItem(pick(ids), {
        label: r() < 0.2 ? null : name(),
        showLabel: r() < 0.5,
        visionFt: pick([null, 0, 30, 60, num(-10, 5000), Number.NaN]),
        hp: pick([
          null,
          { current: num(-1e5, 1e5), max: num(-10, 1e5), publicBar: r() < 0.5 },
          { current: Number.NaN, max: Number.POSITIVE_INFINITY, publicBar: true },
        ]),
        conditions: Array.from({ length: Math.floor(num(0, 30)) }, () =>
          pick(['prone', 'Prone', ' poisoned ', '', longText()]),
        ),
        dmNotes: r() < 0.1 ? 'x'.repeat(25000) : longText(),
        initiativeModifier: pick([null, num(-500, 500), Number.NaN]),
      })
    },
    () => {
      const ids = tokenIds()
      const id = ids.length > 0 ? pick(ids) : null
      const hp = id ? currentScene().layers.tokens.find((t) => t.id === id)?.hp : null
      if (id && hp) {
        updateItem(
          id,
          { hp: { ...hp, current: hp.current + pick([-5, -1, 1, 5]) } },
          {
            coalesceKey: `hp:${id}`,
          },
        )
      }
    },
    () => setSceneFog({ enabled: r() < 0.7, exploredEnabled: r() < 0.8 }),
    () => {
      const mode = pick(['reveal', 'hide'] as const)
      const from = point()
      const shape: FogShape = pick([
        { type: 'rect', x: from.x, y: from.y, width: num(-50, 900), height: num(-50, 900) },
        {
          type: 'polygon',
          points: Array.from({ length: Math.floor(num(0, 12)) }, () => coordinate()),
        },
        {
          type: 'brush',
          points: Array.from({ length: 2 * Math.floor(num(0, 8)) }, () => coordinate()),
          radius: num(-5, 300),
        },
      ])
      addFogEdit(mode, shape)
    },
    () => clearFogEdits(),
    () => resetExplored(),
    () => setNpcVision(r() < 0.5),
    () =>
      setUnrecorded((draft) => {
        draft.presentation.blackout = r() < 0.3
      }),
  ]
  // The initiative tracker (milestone 6).
  const initiativeActions: (() => void)[] = [
    () => addTokensToInitiative(someIds()),
    () => rollInitiative(someIds(), r),
    () => addNamedEntry(r() < 0.2 ? longText() : name(), pick([0, 12, -3, num(-5000, 5000)])),
    () => {
      const ids = entryIds()
      if (ids.length === 0) return
      updateEntry(pick(ids), {
        name: r() < 0.3 ? longText() : name(),
        value: pick([0, 12, 12, num(-5000, 5000), Number.NaN]),
        dexTiebreak: pick([null, 2, 2, num(-50, 50), Number.POSITIVE_INFINITY]),
        visibility: pick(['auto', 'hidden', 'shown'] as const),
      })
    },
    () => {
      const ids = entryIds()
      if (ids.length > 0) toggleEntryVisibility(pick(ids))
    },
    () => {
      const ids = entryIds()
      if (ids.length > 0) removeEntry(pick(ids))
    },
    () => {
      const ids = entryIds()
      if (ids.length > 1)
        moveAmongTies(
          pick(ids),
          r() < 0.5 ? { targetId: pick(ids) } : { step: pick([-1, 1] as const) },
        )
    },
    () => nextTurn(),
    () => nextTurn(),
    () => previousTurn(),
    () => setTrackerVisible(r() < 0.5),
    () => {
      if (r() < 0.2) endCombat()
    },
  ]
  const base: (() => void)[] = [
    ...initiativeActions,
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
  const actions =
    focus === 'fog'
      ? [...base, ...Array.from({ length: 5 }, () => fogActions).flat()]
      : [...base, ...fogActions]
  if (focus === 'fog') setSceneFog({ enabled: true })
  for (let step = 0; step < steps; step++) pick(actions)()
}

function exploredChunks(): number {
  return Object.values(getCampaign().sceneMemory).reduce(
    (sum, memory) => sum + Object.keys(memory.explored.chunks).length,
    0,
  )
}

/** Runs a session and checks the round trip; returns the most explored chunks seen at once. */
function session(seed: number, focus: 'all' | 'fog'): number {
  resetExploredTracking()
  loadCampaign(createCampaign('Fuzz'))
  useUiStore.setState(initialUiState())
  // Explored memory grows as in the DM session (presentation.ts).
  let mostChunks = 0
  const stop = useCampaignStore.subscribe((state, previous) => {
    if (state.campaign === previous.campaign) return
    recordExplored()
    mostChunks = Math.max(mostChunks, exploredChunks())
  })
  try {
    run(seed, 400, focus)
  } finally {
    stop()
  }
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
  return mostChunks
}

describe('the editor never saves a campaign it cannot load', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('random session %i', (seed) => {
    expect(session(seed, 'all')).toBeGreaterThanOrEqual(0)
  })

  it.each([11, 12, 13, 14, 15, 16])('random fog session %i', (seed) => {
    // The session really recorded explored memory (the fuzz is not vacuous).
    expect(session(seed, 'fog')).toBeGreaterThan(0)
  })
})
