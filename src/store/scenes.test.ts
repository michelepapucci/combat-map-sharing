import { beforeEach, describe, expect, it } from 'vitest'
import { createCampaign } from '../state/defaults'
import type { AssetMeta } from '../state/types'
import {
  currentScene,
  placeImage,
  placeToken,
  placeUploadedToken,
  redoAction,
  undoAction,
} from './actions'
import { getCampaign, loadCampaign, setUnrecorded, useCampaignStore } from './campaign'
import { addAssets, assetUsage, parseTags, removeAsset, updateAsset } from './libraryActions'
import {
  addScene,
  deleteScene,
  duplicateScene,
  moveScene,
  renameScene,
  switchScene,
} from './sceneActions'
import { initialUiState, sceneSwitched, useUiStore } from './ui'

const NO_SNAP = { snap: false }

function sceneNames(): string[] {
  return getCampaign().scenes.map((scene) => scene.name)
}

function upload(id: string, kind: AssetMeta['kind'], extra: Partial<AssetMeta> = {}): AssetMeta {
  return {
    id,
    kind,
    name: `${kind} art`,
    tags: [],
    mime: 'image/webp',
    width: 600,
    height: 300,
    bytes: 1000,
    hash: 'a'.repeat(64),
    defaultSize: null,
    defaultKind: null,
    defaultCells: null,
    localOnly: false,
    createdAt: 0,
    ...extra,
  }
}

beforeEach(() => {
  loadCampaign(createCampaign('Test'))
  useUiStore.setState(initialUiState())
})

describe('scenes', () => {
  it('adds a scene after the active one, switches to it, and creates its memory', () => {
    const first = getCampaign().activeSceneId
    const id = addScene()
    expect(sceneNames()).toStrictEqual(['Scene 1', 'Scene 2'])
    expect(getCampaign().activeSceneId).toBe(id)
    expect(getCampaign().sceneMemory[id]).toBeDefined()
    undoAction()
    expect(sceneNames()).toStrictEqual(['Scene 1'])
    expect(getCampaign().activeSceneId).toBe(first)
    redoAction()
    expect(getCampaign().activeSceneId).toBe(id)
    expect(getCampaign().sceneMemory[id]).toBeDefined()
  })

  it('switching scenes is not an undo step', () => {
    const first = getCampaign().activeSceneId
    const second = addScene()
    const steps = useCampaignStore.getState().past.length
    switchScene(first)
    expect(getCampaign().activeSceneId).toBe(first)
    expect(useCampaignStore.getState().past).toHaveLength(steps)
    switchScene(second)
    switchScene('missing')
    expect(getCampaign().activeSceneId).toBe(second)
  })

  it('undo and redo show the scene the change happened in', () => {
    const first = getCampaign().activeSceneId
    const second = addScene()
    switchScene(first)
    placeToken('goblin', { x: 0, y: 0 }, NO_SNAP)
    switchScene(second)
    undoAction()
    expect(getCampaign().activeSceneId).toBe(first)
    expect(currentScene().layers.tokens).toHaveLength(0)
    switchScene(second)
    redoAction()
    expect(getCampaign().activeSceneId).toBe(first)
    expect(currentScene().layers.tokens).toHaveLength(1)
  })

  it('deleting a scene keeps its memory; undo restores and shows it', () => {
    const first = getCampaign().activeSceneId
    const second = addScene()
    placeToken('wolf', { x: 0, y: 0 }, NO_SNAP)
    setUnrecorded((draft) => {
      const memory = draft.sceneMemory[second]
      if (memory) memory.explored.chunks['0,0'] = 'AQ=='
    })
    expect(deleteScene(second)).toBe(true)
    expect(getCampaign().activeSceneId).toBe(first)
    expect(getCampaign().sceneMemory[second]?.explored.chunks).toStrictEqual({ '0,0': 'AQ==' })
    undoAction()
    expect(getCampaign().activeSceneId).toBe(second)
    expect(currentScene().layers.tokens).toHaveLength(1)
  })

  it('the last scene cannot be deleted', () => {
    expect(deleteScene(getCampaign().activeSceneId)).toBe(false)
    expect(sceneNames()).toHaveLength(1)
  })

  it('duplicates with fresh ids, remapped initiative links and copied memory', () => {
    const tokenId = placeToken('goblin', { x: 0, y: 0 }, NO_SNAP)
    const source = getCampaign().activeSceneId
    setUnrecorded((draft) => {
      const scene = draft.scenes[0]
      if (!scene || !tokenId) return
      scene.initiative.entries.push({
        id: 'entry-1',
        tokenId,
        name: 'Goblin',
        value: 12,
        dexTiebreak: null,
        manualOrder: 0,
        visibility: 'auto',
      })
      scene.initiative.activeEntryId = 'entry-1'
      const memory = draft.sceneMemory[source]
      if (memory) memory.playerView = { x: 1, y: 2, width: 3, height: 4 }
    })
    const copyId = duplicateScene(source)
    expect(sceneNames()).toStrictEqual(['Scene 1', 'Scene 1 (copy)'])
    expect(getCampaign().activeSceneId).toBe(copyId)
    const copy = currentScene()
    const copiedToken = copy.layers.tokens[0]
    expect(copiedToken?.id).not.toBe(tokenId)
    expect(copy.initiative.entries[0]?.tokenId).toBe(copiedToken?.id)
    expect(copy.initiative.activeEntryId).toBe(copy.initiative.entries[0]?.id)
    expect(copy.initiative.entries[0]?.id).not.toBe('entry-1')
    expect(getCampaign().sceneMemory[copy.id]?.playerView).toStrictEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    })
    duplicateScene(source)
    expect(sceneNames()).toContain('Scene 1 (copy 2)')
  })

  it('renames and reorders', () => {
    const first = getCampaign().activeSceneId
    addScene()
    renameScene(first, '  Cellar  ')
    renameScene(first, '   ')
    expect(sceneNames()).toStrictEqual(['Cellar', 'Scene 2'])
    moveScene(first, 1)
    expect(sceneNames()).toStrictEqual(['Scene 2', 'Cellar'])
    moveScene(first, 1)
    expect(sceneNames()).toStrictEqual(['Scene 2', 'Cellar'])
    undoAction()
    expect(sceneNames()).toStrictEqual(['Cellar', 'Scene 2'])
  })

  it('remembers the view per scene and fits scenes never seen', () => {
    const first = getCampaign().activeSceneId
    useUiStore.setState({ dmCamera: { x: 5, y: 6, zoom: 2 }, fitPending: false, selection: ['x'] })
    sceneSwitched(first, 'other')
    expect(useUiStore.getState()).toMatchObject({ fitPending: true, selection: [] })
    useUiStore.setState({ dmCamera: { x: 0, y: 0, zoom: 1 } })
    sceneSwitched('other', first)
    expect(useUiStore.getState()).toMatchObject({
      dmCamera: { x: 5, y: 6, zoom: 2 },
      fitPending: false,
    })
  })
})

describe('library', () => {
  it('places uploaded tokens with the asset defaults, and props at their footprint', () => {
    addAssets([
      upload('tok', 'token', { name: 'Aria', defaultSize: 'large', defaultKind: 'player' }),
      upload('plain', 'token'),
      upload('cart', 'prop'),
      upload('mill', 'map', { width: 3000, height: 2000 }),
    ])
    const aria = placeUploadedToken('tok', { x: 0, y: 0 }, NO_SNAP)
    const plain = placeUploadedToken('plain', { x: 0, y: 0 }, NO_SNAP)
    const tokens = currentScene().layers.tokens
    expect(tokens.find((t) => t.id === aria)).toMatchObject({
      name: 'Aria 1',
      kind: 'player',
      sizeCategory: 'large',
      width: 140,
      badge: '1',
    })
    // An upload without a default kind becomes an enemy (never a fog-revealing player).
    expect(tokens.find((t) => t.id === plain)).toMatchObject({
      kind: 'enemy',
      sizeCategory: 'medium',
    })
    placeImage('cart', { x: 0, y: 0 }, NO_SNAP)
    expect(currentScene().layers.props[0]).toMatchObject({ width: 140, height: 70 })
    placeImage('mill', { x: 0, y: 0 }, NO_SNAP)
    expect(currentScene().layers.map[0]).toMatchObject({ width: 3000, height: 2000 })
    expect(placeUploadedToken('cart', { x: 0, y: 0 }, NO_SNAP)).toBeNull()
  })

  it('edits assets; defaults follow the kind', () => {
    addAssets([upload('a', 'token', { defaultSize: 'small', defaultKind: 'npc' })])
    updateAsset('a', { name: '  Ruined mill ', tags: parseTags('Ruins, night ,ruins,,') })
    expect(getCampaign().library[0]).toMatchObject({
      name: 'Ruined mill',
      tags: ['ruins', 'night'],
    })
    updateAsset('a', { kind: 'prop', defaultCells: { w: 2, h: 3 } })
    expect(getCampaign().library[0]).toMatchObject({
      kind: 'prop',
      defaultSize: null,
      defaultKind: null,
      defaultCells: { w: 2, h: 3 },
    })
    updateAsset('a', { name: '   ' })
    expect(getCampaign().library[0]?.name).toBe('Ruined mill')
  })

  it('reports usage over scenes, the splash image and undo history', () => {
    addAssets([upload('p', 'prop'), upload('q', 'prop')])
    expect(assetUsage('p')).toStrictEqual({ items: 0, scenes: 0, splash: false, inHistory: false })
    placeImage('p', { x: 0, y: 0 }, NO_SNAP)
    placeImage('p', { x: 0, y: 0 }, NO_SNAP)
    addScene()
    placeImage('p', { x: 0, y: 0 }, NO_SNAP)
    expect(assetUsage('p')).toMatchObject({ items: 3, scenes: 2, inHistory: true })
    expect(assetUsage('q').inHistory).toBe(false)
  })

  it('removing an unused asset keeps undo history', () => {
    addAssets([upload('p', 'prop')])
    placeToken('goblin', { x: 0, y: 0 }, NO_SNAP)
    expect(removeAsset('p')).toBe(true)
    expect(getCampaign().library).toStrictEqual([])
    expect(useCampaignStore.getState().past).toHaveLength(1)
  })

  it('removing an asset in use removes its items everywhere and clears history', () => {
    addAssets([upload('p', 'prop'), upload('t', 'token')])
    placeImage('p', { x: 0, y: 0 }, NO_SNAP)
    placeUploadedToken('t', { x: 0, y: 0 }, NO_SNAP)
    addScene()
    placeImage('p', { x: 0, y: 0 }, NO_SNAP)
    setUnrecorded((draft) => {
      draft.presentation.splashAssetId = 'p'
    })
    const prop = currentScene().layers.props[0]
    if (!prop) throw new Error('prop not placed')
    useUiStore.setState({ clipboard: [{ layer: 'props', item: { ...prop, id: 'c' } }] })
    removeAsset('p')
    const { scenes, presentation } = getCampaign()
    expect(scenes.map((s) => s.layers.props.length)).toStrictEqual([0, 0])
    expect(scenes[0]?.layers.tokens).toHaveLength(1)
    expect(presentation.splashAssetId).toBeNull()
    expect(useCampaignStore.getState().past).toStrictEqual([])
    expect(useUiStore.getState().clipboard).toBeNull()
  })

  it('removing an asset only mentioned by history (deleted items) also clears history', () => {
    addAssets([upload('p', 'prop')])
    placeImage('p', { x: 0, y: 0 }, NO_SNAP)
    undoAction()
    expect(assetUsage('p')).toMatchObject({ items: 0, inHistory: true })
    removeAsset('p')
    expect(useCampaignStore.getState().future).toStrictEqual([])
  })
})
