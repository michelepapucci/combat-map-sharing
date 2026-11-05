import { beforeEach, describe, expect, it } from 'vitest'
import { effectiveVisibility, sortInitiative } from '../geometry/initiative'
import { createCampaign } from '../state/defaults'
import type { Id } from '../state/types'
import {
  currentScene,
  deleteItems,
  placeToken,
  redoAction,
  toggleHidden,
  undoAction,
  updateItem,
} from './actions'
import { loadCampaign, setUnrecorded, useCampaignStore } from './campaign'
import {
  addNamedEntry,
  addTokensToInitiative,
  centerOnActiveToken,
  endCombat,
  entryNameFor,
  moveAmongTies,
  nextTurn,
  previousTurn,
  removeEntry,
  rollD20,
  rollInitiative,
  setTrackerVisible,
  toggleEntryVisibility,
  updateEntry,
} from './initiativeActions'
import { useSessionStore } from './session'
import { initialUiState, useUiStore } from './ui'

const NO_SNAP = { snap: false }

function place(preset: string): Id {
  const id = placeToken(preset, { x: 0, y: 0 }, NO_SNAP)
  if (!id) throw new Error('not placed')
  return id
}

function tracker() {
  return currentScene().initiative
}

/** Names in turn order, the active one marked with '>'. */
function order(): string[] {
  const { entries, activeEntryId } = tracker()
  return sortInitiative(entries).map((e) => `${e.id === activeEntryId ? '>' : ''}${e.name}`)
}

function entryOf(tokenId: Id) {
  const entry = tracker().entries.find((e) => e.tokenId === tokenId)
  if (!entry) throw new Error('no entry')
  return entry
}

/** A fixed sequence of "random" numbers in [0, 1). */
function sequence(...values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length] ?? 0
}

beforeEach(() => {
  loadCampaign(createCampaign('Test'))
  useUiStore.setState(initialUiState())
})

describe('adding entries', () => {
  it('adds selected tokens once, named by their shown label or their name', () => {
    const hero = place('hero')
    const goblin = place('goblin')
    updateItem(hero, { label: 'Aria', showLabel: true })
    updateItem(goblin, { label: 'Hooded figure', showLabel: false })
    expect(addTokensToInitiative([hero, goblin])).toBe(2)
    expect(addTokensToInitiative([hero, goblin])).toBe(0)
    expect(order()).toStrictEqual(['Aria', 'Goblin 1'])
    expect(tracker().entries.map((e) => [e.value, e.visibility])).toStrictEqual([
      [0, 'auto'],
      [0, 'auto'],
    ])
  })

  it('entry names never come out empty', () => {
    expect(entryNameFor({ name: '   ', label: null, showLabel: false })).toBe('Creature')
    expect(entryNameFor({ name: 'Orc', label: '  ', showLabel: true })).toBe('Orc')
  })

  it('adds named entries; an empty name is refused', () => {
    expect(addNamedEntry('  Lair action ', 20)).toBe(true)
    expect(addNamedEntry('   ', 5)).toBe(false)
    expect(tracker().entries.map((e) => [e.name, e.value, e.tokenId])).toStrictEqual([
      ['Lair action', 20, null],
    ])
  })

  it('d20 covers 1..20', () => {
    expect(rollD20(() => 0)).toBe(1)
    expect(rollD20(() => 0.999_999)).toBe(20)
    const faces = new Set(Array.from({ length: 2000 }, () => rollD20()))
    expect([...faces].toSorted((a, b) => a - b)).toStrictEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    )
  })

  it('rolls d20 + modifier for non-players; players are only added; re-rolls update', () => {
    const hero = place('hero')
    const goblin = place('goblin')
    const wolf = place('wolf')
    updateItem(goblin, { initiativeModifier: 2 })
    // 0.5 → 11, 0.1 → 3
    const rolls = rollInitiative([hero, goblin, wolf], sequence(0.5, 0.1))
    expect(rolls).toStrictEqual([
      { name: 'Goblin 1', total: 13 },
      { name: 'Wolf 1', total: 3 },
    ])
    expect(entryOf(goblin)).toMatchObject({ value: 13, dexTiebreak: 2 })
    expect(entryOf(wolf)).toMatchObject({ value: 3, dexTiebreak: null })
    expect(entryOf(hero)).toMatchObject({ value: 0 })
    expect(order()).toStrictEqual(['Goblin 1', 'Wolf 1', 'Hero 1'])
    rollInitiative([goblin], () => 0.95) // 20 + 2
    expect(entryOf(goblin).value).toBe(22)
    expect(tracker().entries).toHaveLength(3)
  })
})

function threeEntries(): void {
  addNamedEntry('A', 20)
  addNamedEntry('B', 15)
  addNamedEntry('C', 10)
}

/** The id of the entry with this name. */
function idOf(name: string): Id {
  return tracker().entries.find((e) => e.name === name)?.id ?? ''
}

describe('turns', () => {
  it('next starts combat, advances, and wraps into a new round; previous goes back', () => {
    expect(nextTurn()).toBe(false) // empty
    threeEntries()
    expect(tracker().round).toBe(1)
    nextTurn()
    expect(order()).toStrictEqual(['>A', 'B', 'C'])
    nextTurn()
    nextTurn()
    expect(order()).toStrictEqual(['A', 'B', '>C'])
    nextTurn()
    expect(order()).toStrictEqual(['>A', 'B', 'C'])
    expect(tracker().round).toBe(2)
    previousTurn()
    expect(order()).toStrictEqual(['A', 'B', '>C'])
    expect(tracker().round).toBe(1)
    previousTurn()
    previousTurn()
    expect(order()).toStrictEqual(['>A', 'B', 'C'])
    expect(previousTurn()).toBe(false) // the very first turn
  })

  it('editing values re-sorts without moving the turn', () => {
    threeEntries()
    nextTurn()
    nextTurn() // B
    const b = tracker().entries.find((e) => e.name === 'B')
    updateEntry(b?.id ?? '', { value: 25 })
    expect(order()).toStrictEqual(['>B', 'A', 'C'])
  })

  it('removing the active entry passes the turn on (a new round when it wraps)', () => {
    threeEntries()
    nextTurn()
    nextTurn()
    nextTurn() // C, round 1
    const c = tracker().activeEntryId ?? ''
    removeEntry(c)
    expect(order()).toStrictEqual(['>A', 'B'])
    expect(tracker().round).toBe(2)
    removeEntry(tracker().entries.find((e) => e.name === 'B')?.id ?? '')
    removeEntry(tracker().activeEntryId ?? '')
    // Empty again: the next combat starts from round 1.
    expect(tracker()).toMatchObject({ entries: [], activeEntryId: null, round: 1 })
  })

  it('turn changes and end of combat are undoable', () => {
    threeEntries()
    setTrackerVisible(true)
    nextTurn()
    nextTurn()
    undoAction()
    expect(order()).toStrictEqual(['>A', 'B', 'C'])
    redoAction()
    endCombat()
    expect(tracker()).toMatchObject({ entries: [], activeEntryId: null, round: 1 })
    expect(tracker().visibleToPlayers).toBe(true)
    undoAction()
    expect(order()).toStrictEqual(['A', '>B', 'C'])
  })
})

describe('center on active', () => {
  it('centers the DM camera on the active token, keeping the zoom', () => {
    const goblin = place('goblin')
    addTokensToInitiative([goblin])
    expect(centerOnActiveToken()).toBe(false) // no turn yet
    nextTurn()
    useUiStore.setState({ dmCamera: { x: 500, y: 500, zoom: 2 } })
    expect(centerOnActiveToken()).toBe(true)
    const token = currentScene().layers.tokens.find((t) => t.id === goblin)
    expect(useUiStore.getState().dmCamera).toStrictEqual({ x: token?.x, y: token?.y, zoom: 2 })
  })

  it('refuses while players follow the DM camera and cannot see the creature', () => {
    const goblin = place('goblin')
    addTokensToInitiative([goblin])
    nextTurn()
    toggleHidden([goblin])
    setUnrecorded((draft) => {
      draft.presentation.cameraMode = 'follow'
    })
    useSessionStore.setState({ players: 1 })
    useUiStore.setState({ dmCamera: { x: 500, y: 500, zoom: 1 } })
    try {
      expect(centerOnActiveToken()).toBe(false)
      expect(useUiStore.getState().dmCamera).toStrictEqual({ x: 500, y: 500, zoom: 1 })
      toggleHidden([goblin])
      expect(centerOnActiveToken()).toBe(true)
    } finally {
      useSessionStore.setState({ players: 0 })
    }
  })
})

describe('ties and visibility', () => {
  it('ties sort by dex tiebreak, then by manual order, which only ties can change', () => {
    addNamedEntry('A', 12)
    addNamedEntry('B', 12)
    addNamedEntry('C', 12)
    addNamedEntry('D', 8)
    expect(order()).toStrictEqual(['A', 'B', 'C', 'D'])
    expect(moveAmongTies(idOf('C'), { targetId: idOf('A') })).toBe(true)
    expect(order()).toStrictEqual(['C', 'A', 'B', 'D'])
    expect(moveAmongTies(idOf('A'), { step: 1 })).toBe(true)
    expect(order()).toStrictEqual(['C', 'B', 'A', 'D'])
    // Not tied: refused.
    expect(moveAmongTies(idOf('D'), { targetId: idOf('A') })).toBe(false)
    expect(moveAmongTies(idOf('C'), { step: -1 })).toBe(false)
    // A dex tiebreak beats the manual order.
    updateEntry(idOf('A'), { dexTiebreak: 3 })
    expect(order()).toStrictEqual(['A', 'C', 'B', 'D'])
    const steps = useCampaignStore.getState().past.length
    undoAction()
    expect(useCampaignStore.getState().past).toHaveLength(steps - 1)
  })

  it('the eye toggle overrides auto and returns to it', () => {
    const goblin = place('goblin')
    addTokensToInitiative([goblin])
    const entry = () => entryOf(goblin)
    expect(effectiveVisibility(entry(), currentScene())).toBe('shown')
    toggleEntryVisibility(entry().id)
    expect(entry().visibility).toBe('hidden')
    toggleEntryVisibility(entry().id)
    expect(entry().visibility).toBe('auto')
    // A hidden token's entry is hidden automatically, and can be shown on its own.
    toggleHidden([goblin])
    expect(effectiveVisibility(entry(), currentScene())).toBe('hidden')
    toggleEntryVisibility(entry().id)
    expect(entry().visibility).toBe('shown')
    toggleEntryVisibility(entry().id)
    expect(entry().visibility).toBe('auto')
  })

  it('an entry outlives its deleted token, hidden from players', () => {
    const goblin = place('goblin')
    addTokensToInitiative([goblin])
    deleteItems([goblin])
    expect(tracker().entries).toHaveLength(1)
    expect(effectiveVisibility(entryOf(goblin), currentScene())).toBe('hidden')
  })
})
