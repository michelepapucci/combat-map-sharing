import { describe, expect, it } from 'vitest'
import type { InitiativeEntry, Scene, Token } from '../state/types'
import { effectiveVisibility, sortInitiative } from './initiative'

function entry(id: string, init: Partial<InitiativeEntry> = {}): InitiativeEntry {
  return {
    id,
    tokenId: null,
    name: id,
    value: 10,
    dexTiebreak: null,
    manualOrder: 0,
    visibility: 'auto',
    ...init,
  }
}

function token(id: string, hidden = false): Token {
  return {
    id,
    assetId: 'builtin:token/initials',
    name: id,
    x: 0,
    y: 0,
    width: 50,
    height: 50,
    rotation: 0,
    locked: false,
    hidden,
    opacity: 1,
    kind: 'enemy',
    sizeCategory: 'medium',
    visionFt: null,
    label: null,
    showLabel: false,
    badge: null,
    hp: null,
    conditions: [],
    color: '#ef4444',
    dmNotes: '',
    initiativeModifier: null,
  }
}

function scene(tokens: Token[], tokensVisible = true): Pick<Scene, 'layers' | 'layerState'> {
  return {
    layers: { map: [], props: [], tokens },
    layerState: {
      map: { locked: true, visible: true },
      props: { locked: false, visible: true },
      tokens: { locked: false, visible: tokensVisible },
    },
  }
}

const ids = (entries: InitiativeEntry[]) => entries.map((e) => e.id)

describe('sortInitiative', () => {
  it('sorts by value, highest first', () => {
    const entries = [entry('a', { value: 5 }), entry('b', { value: 20 }), entry('c', { value: 12 })]
    expect(ids(sortInitiative(entries))).toStrictEqual(['b', 'c', 'a'])
  })

  it('breaks ties by dex tiebreak (highest first, missing last), then manual order', () => {
    const entries = [
      entry('none-late', { manualOrder: 5 }),
      entry('dex-low', { dexTiebreak: 8 }),
      entry('none-early', { manualOrder: 1 }),
      entry('dex-high', { dexTiebreak: 16 }),
      entry('dex-low-first', { dexTiebreak: 8, manualOrder: -1 }),
      entry('negative-dex', { dexTiebreak: -1 }),
    ]
    expect(ids(sortInitiative(entries))).toStrictEqual([
      'dex-high',
      'dex-low-first',
      'dex-low',
      'negative-dex',
      'none-early',
      'none-late',
    ])
  })

  it('falls back to the id so the order is stable', () => {
    const entries = [entry('b'), entry('c'), entry('a')]
    expect(ids(sortInitiative(entries))).toStrictEqual(['a', 'b', 'c'])
    expect(ids(sortInitiative(entries.toReversed()))).toStrictEqual(['a', 'b', 'c'])
  })

  it('returns a new array and leaves the input alone', () => {
    const entries = [entry('a', { value: 1 }), entry('b', { value: 2 })]
    const sorted = sortInitiative(entries)
    expect(sorted).not.toBe(entries)
    expect(ids(entries)).toStrictEqual(['a', 'b'])
    expect(sorted[0]).toBe(entries[1])
  })
})

describe('effectiveVisibility', () => {
  const visible = token('visible')
  const hidden = token('hidden', true)

  it('honors explicit overrides whatever the token', () => {
    const s = scene([visible, hidden])
    expect(effectiveVisibility(entry('e', { tokenId: 'visible', visibility: 'hidden' }), s)).toBe(
      'hidden',
    )
    expect(effectiveVisibility(entry('e', { tokenId: 'hidden', visibility: 'shown' }), s)).toBe(
      'shown',
    )
    expect(effectiveVisibility(entry('e', { tokenId: 'gone', visibility: 'shown' }), s)).toBe(
      'shown',
    )
    expect(effectiveVisibility(entry('e', { visibility: 'hidden' }), s)).toBe('hidden')
  })

  it("'auto' follows the linked token", () => {
    const s = scene([visible, hidden])
    expect(effectiveVisibility(entry('e', { tokenId: 'visible' }), s)).toBe('shown')
    expect(effectiveVisibility(entry('e', { tokenId: 'hidden' }), s)).toBe('hidden')
    expect(effectiveVisibility(entry('e', { tokenId: 'gone' }), s)).toBe('hidden')
  })

  it("'auto' hides entries whose token is on a hidden layer", () => {
    expect(effectiveVisibility(entry('e', { tokenId: 'visible' }), scene([visible], false))).toBe(
      'hidden',
    )
  })

  it("'auto' without a token (added by name) is shown", () => {
    expect(effectiveVisibility(entry('e'), scene([], false))).toBe('shown')
  })

  it('fails closed on unknown values', () => {
    const odd = entry('e', { visibility: 'maybe' as InitiativeEntry['visibility'] })
    expect(effectiveVisibility(odd, scene([visible]))).toBe('hidden')
  })
})
