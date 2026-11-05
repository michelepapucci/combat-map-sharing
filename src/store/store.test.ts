import { beforeEach, describe, expect, it } from 'vitest'
import { createCampaign } from '../state/defaults'
import type { Token } from '../state/types'
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
  reorderItems,
  setLayerState,
  setSnapEnabled,
  toggleHidden,
  toggleLocked,
  transformItems,
  undoAction,
  redoAction,
  updateGrid,
  updateItem,
} from './actions'
import { commit, getCampaign, loadCampaign, useCampaignStore } from './campaign'
import { HISTORY_LIMIT, pushEntry, type HistoryEntry } from './history'
import { initialUiState, useUiStore } from './ui'

const NO_SNAP = { snap: false }
const SNAP = { snap: true }

function tokens(): Token[] {
  return currentScene().layers.tokens
}

function token(id: string | null): Token {
  const found = tokens().find((t) => t.id === id)
  if (!found) throw new Error(`token ${id} not found`)
  return found
}

beforeEach(() => {
  loadCampaign(createCampaign('Test'))
  useUiStore.setState(initialUiState())
})

const entry = (label: string, key: string | null, time: number): HistoryEntry => ({
  label,
  patches: [{ op: 'replace', path: ['name'], value: label }],
  inversePatches: [{ op: 'replace', path: ['name'], value: `before ${label}` }],
  coalesceKey: key,
  time,
})

describe('history', () => {
  it('coalesces consecutive entries with the same key within the window', () => {
    let past = pushEntry([], entry('a', 'slider', 0))
    past = pushEntry(past, entry('b', 'slider', 500))
    past = pushEntry(past, entry('c', 'slider', 1400))
    expect(past).toHaveLength(1)
    expect(past[0]?.patches.map((p) => p.value)).toStrictEqual(['a', 'b', 'c'])
    // Undo applies the newest inverse first and ends at the oldest one.
    expect(past[0]?.inversePatches.map((p) => p.value)).toStrictEqual([
      'before c',
      'before b',
      'before a',
    ])
    past = pushEntry(past, entry('d', 'slider', 3000))
    past = pushEntry(past, entry('e', 'other', 3100))
    expect(past).toHaveLength(3)
  })

  it(`keeps at most ${HISTORY_LIMIT} entries`, () => {
    let past: HistoryEntry[] = []
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) past = pushEntry(past, entry(String(i), null, i))
    expect(past).toHaveLength(HISTORY_LIMIT)
    expect(past[0]?.label).toBe('5')
  })

  it('records only scenes and name; other fields survive undo', () => {
    commit('rename', (d) => {
      d.name = 'Renamed'
      d.settings.shareRuler = true
    })
    setSnapEnabled(false)
    undoAction()
    const campaign = getCampaign()
    expect(campaign.name).toBe('Test')
    expect(campaign.settings.shareRuler).toBe(true)
    expect(campaign.settings.snapEnabled).toBe(false)
    redoAction()
    expect(getCampaign().name).toBe('Renamed')
  })

  it('a change of unrecorded fields only adds no undo entry', () => {
    commit('settings', (d) => {
      d.settings.npcVision = true
    })
    expect(useCampaignStore.getState().past).toHaveLength(0)
    expect(getCampaign().settings.npcVision).toBe(true)
  })

  it('a no-op commit adds nothing', () => {
    expect(commit('nothing', () => undefined)).toBe(false)
    expect(useCampaignStore.getState().past).toHaveLength(0)
  })
})

describe('placing', () => {
  it('auto-numbers tokens and derives badges', () => {
    const a = placeToken('goblin', { x: 0, y: 0 }, NO_SNAP)
    const b = placeToken('goblin', { x: 0, y: 0 }, NO_SNAP)
    expect(token(a).name).toBe('Goblin 1')
    expect(token(b).name).toBe('Goblin 2')
    expect(token(b).badge).toBe('G2')
    expect(token(b).kind).toBe('enemy')
    const wolf = placeToken('wolf', { x: 0, y: 0 }, NO_SNAP)
    expect(token(wolf).badge).toBe('1')
    expect(useUiStore.getState().selection).toStrictEqual([wolf])
  })

  it('sizes tokens from the size category and snaps their footprint', () => {
    const ogre = placeToken('ogre', { x: 100, y: 100 }, SNAP)
    expect(token(ogre)).toMatchObject({ width: 140, height: 140, x: 70, y: 70 })
    const hero = placeToken('hero', { x: 100, y: 100 }, SNAP)
    expect(token(hero)).toMatchObject({ width: 70, x: 105, y: 105 })
  })

  it('uses the chosen color, or the kind color', () => {
    useUiStore.setState({ tokenColor: '#123456' })
    const a = placeToken('hero', { x: 0, y: 0 }, NO_SNAP)
    expect(token(a).color).toBe('#123456')
  })

  it('places props at their default footprint and maps at native size', () => {
    const tree = placeImage('builtin:prop/tree', { x: 75, y: 75 }, SNAP)
    const prop = currentScene().layers.props.find((p) => p.id === tree)
    expect(prop).toMatchObject({ width: 140, height: 140, x: 70, y: 70 })
    const map = placeImage('builtin:map/grass', { x: 3, y: -2 }, { snap: true, anchor: 'top-left' })
    const placed = currentScene().layers.map.find((m) => m.id === map)
    expect(placed).toMatchObject({ width: 1680, height: 1260, x: 840, y: 630 })
    // The map layer is locked by default, so the new map is not selected.
    expect(useUiStore.getState().selection).toStrictEqual([])
  })

  it('ignores unknown assets', () => {
    expect(placeImage('builtin:prop/nope', { x: 0, y: 0 }, SNAP)).toBeNull()
    expect(placeToken('nope', { x: 0, y: 0 }, SNAP)).toBeNull()
  })
})

describe('editing', () => {
  it('moves items in one undo step', () => {
    const a = placeToken('hero', { x: 35, y: 35 }, NO_SNAP)
    const b = placeToken('ally', { x: 105, y: 35 }, NO_SNAP)
    if (!a || !b) throw new Error('not placed')
    moveItems({ [a]: { x: 35, y: 105 }, [b]: { x: 105, y: 105 } })
    expect(token(a).y).toBe(105)
    undoAction()
    expect(token(a).y).toBe(35)
    expect(token(b).y).toBe(35)
  })

  it('never moves or deletes locked items', () => {
    const a = placeToken('hero', { x: 35, y: 35 }, NO_SNAP)
    if (!a) throw new Error('not placed')
    toggleLocked([a])
    expect(token(a).locked).toBe(true)
    moveItems({ [a]: { x: 0, y: 0 } })
    nudgeItems([a], 70, 0)
    deleteItems([a])
    expect(token(a)).toMatchObject({ x: 35, y: 35 })
    expect(useUiStore.getState().notice?.text).toMatch(/Unlock/)
  })

  it('coalesces repeated nudges', () => {
    const a = placeToken('hero', { x: 35, y: 35 }, NO_SNAP)
    if (!a) throw new Error('not placed')
    const before = useCampaignStore.getState().past.length
    nudgeItems([a], 70, 0)
    nudgeItems([a], 70, 0)
    nudgeItems([a], 0, 1)
    expect(token(a)).toMatchObject({ x: 175, y: 36 })
    expect(useCampaignStore.getState().past.length).toBe(before + 1)
    undoAction()
    expect(token(a)).toMatchObject({ x: 35, y: 35 })
  })

  it('transforms props but only rotates tokens', () => {
    const tree = placeImage('builtin:prop/tree', { x: 70, y: 70 }, SNAP)
    const hero = placeToken('hero', { x: 35, y: 35 }, NO_SNAP)
    if (!tree || !hero) throw new Error('not placed')
    transformItems({
      [tree]: { x: 80, y: 80, width: 210, height: 70, rotation: -90 },
      [hero]: { x: 35, y: 35, width: 500, height: 500, rotation: 45 },
    })
    expect(currentScene().layers.props[0]).toMatchObject({ width: 210, height: 70, rotation: 270 })
    expect(token(hero)).toMatchObject({ width: 70, height: 70, rotation: 45 })
  })

  it('deletes, then undo restores at the same z-order', () => {
    const ids = ['hero', 'ally', 'goblin'].map((p) => placeToken(p, { x: 0, y: 0 }, NO_SNAP))
    deleteItems([ids[1] ?? ''])
    expect(tokens().map((t) => t.name)).toStrictEqual(['Hero 1', 'Goblin 1'])
    undoAction()
    expect(tokens().map((t) => t.name)).toStrictEqual(['Hero 1', 'Ally 1', 'Goblin 1'])
  })

  it('duplicates with renumbering and a one-cell offset', () => {
    const a = placeToken('goblin', { x: 35, y: 35 }, NO_SNAP)
    if (!a) throw new Error('not placed')
    const [copy] = duplicateItems([a])
    expect(token(copy ?? null)).toMatchObject({ name: 'Goblin 2', badge: 'G2', x: 105, y: 105 })
    expect(useUiStore.getState().selection).toStrictEqual([copy])
  })

  it('keeps a custom badge when duplicating', () => {
    const a = placeToken('goblin', { x: 35, y: 35 }, NO_SNAP)
    if (!a) throw new Error('not placed')
    updateItem(a, { badge: 'X' })
    const [copy] = duplicateItems([a])
    expect(token(copy ?? null).badge).toBe('X')
  })

  it('pastes at the pointer by whole cells, or offset by one more cell each time', () => {
    const a = placeToken('hero', { x: 35, y: 35 }, NO_SNAP)
    if (!a) throw new Error('not placed')
    copyItems([a])
    const [p1] = pasteItems(null)
    const [p2] = pasteItems(null)
    expect(token(p1 ?? null)).toMatchObject({ x: 105, y: 105, name: 'Hero 2' })
    expect(token(p2 ?? null)).toMatchObject({ x: 175, y: 175, name: 'Hero 3' })
    const [p3] = pasteItems({ x: 400, y: 30 })
    expect(token(p3 ?? null)).toMatchObject({ x: 385, y: 35 })
  })

  it('toggles hidden for the whole selection', () => {
    const a = placeToken('hero', { x: 0, y: 0 }, NO_SNAP)
    const b = placeToken('ally', { x: 0, y: 0 }, NO_SNAP)
    if (!a || !b) throw new Error('not placed')
    updateItem(a, { hidden: true })
    toggleHidden([a, b])
    expect(token(a).hidden && token(b).hidden).toBe(true)
    toggleHidden([a, b])
    expect(token(a).hidden || token(b).hidden).toBe(false)
  })

  it('reorders within a layer', () => {
    const ids = ['hero', 'ally', 'goblin'].map((p) => placeToken(p, { x: 0, y: 0 }, NO_SNAP) ?? '')
    reorderItems([ids[0] ?? ''], 'forward')
    expect(tokens().map((t) => t.name)).toStrictEqual(['Ally 1', 'Hero 1', 'Goblin 1'])
    reorderItems([ids[2] ?? ''], 'backward')
    expect(tokens().map((t) => t.name)).toStrictEqual(['Ally 1', 'Goblin 1', 'Hero 1'])
    const before = useCampaignStore.getState().past.length
    reorderItems([ids[0] ?? ''], 'forward') // already on top: nothing to record
    expect(useCampaignStore.getState().past.length).toBe(before)
  })

  it('renames the automatic badge with the token, and resizes from the top-left corner', () => {
    const a = placeToken('goblin', { x: 35, y: 35 }, NO_SNAP)
    if (!a) throw new Error('not placed')
    updateItem(a, { name: 'Orc Boss' })
    expect(token(a).badge).toBe('OB')
    updateItem(a, { sizeCategory: 'large' })
    expect(token(a)).toMatchObject({ x: 70, y: 70, width: 140, height: 140, sizeCategory: 'large' })
  })
})

describe('grid and layers', () => {
  it('a new cell size resizes tokens and the empty explored mask', () => {
    const a = placeToken('ogre', { x: 140, y: 140 }, NO_SNAP)
    updateGrid({ size: 100 })
    expect(token(a)).toMatchObject({ width: 200, x: 140 })
    const scene = currentScene()
    expect(getCampaign().sceneMemory[scene.id]?.explored.cellPx).toBe(25)
    undoAction()
    expect(token(a).width).toBe(140)
    expect(currentScene().grid.size).toBe(70)
  })

  it('normalizes offsets into [0, size) and clamps the size', () => {
    updateGrid({ offsetX: -10, offsetY: 150 })
    expect(currentScene().grid).toMatchObject({ offsetX: 60, offsetY: 10 })
    updateGrid({ size: 0 })
    expect(currentScene().grid.size).toBe(4)
  })

  it('calibrates from a box', () => {
    expect(calibrateGrid({ x: 10, y: 20, width: 144, height: 144 }, 2)).toBe(true)
    expect(currentScene().grid).toMatchObject({ size: 72, offsetX: 10, offsetY: 20 })
    expect(calibrateGrid({ x: 0, y: 0, width: 2, height: 2 }, 1)).toBe(false)
  })

  it('locking a layer drops its items from the selection', () => {
    const a = placeToken('hero', { x: 0, y: 0 }, NO_SNAP)
    expect(useUiStore.getState().selection).toStrictEqual([a])
    setLayerState('tokens', { locked: true })
    expect(useUiStore.getState().selection).toStrictEqual([])
    expect(currentScene().layerState.tokens.locked).toBe(true)
  })

  it('undo drops removed items from the selection', () => {
    const a = placeToken('hero', { x: 0, y: 0 }, NO_SNAP)
    expect(useUiStore.getState().selection).toStrictEqual([a])
    undoAction()
    expect(useUiStore.getState().selection).toStrictEqual([])
  })
})
