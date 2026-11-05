import { beforeEach, describe, expect, it } from 'vitest'
import { createCampaign } from '../state/defaults'
import type { Token } from '../state/types'
import { currentScene, placeToken, redoAction, undoAction, updateItem } from './actions'
import { getCampaign, loadCampaign, setUnrecorded, useCampaignStore } from './campaign'
import { addFogEdit, clearFogEdits, resetExplored, setNpcVision, setSceneFog } from './fogActions'
import { initialUiState, useUiStore } from './ui'

const NO_SNAP = { snap: false }

function token(id: string | null): Token {
  const found = currentScene().layers.tokens.find((t) => t.id === id)
  if (!found) throw new Error(`token ${id} not found`)
  return found
}

beforeEach(() => {
  loadCampaign(createCampaign('Test'))
  useUiStore.setState(initialUiState())
})

describe('token properties', () => {
  it('edits label, vision, notes; empty label and vision become null', () => {
    const id = placeToken('hero', { x: 0, y: 0 }, NO_SNAP)
    updateItem(id ?? '', { label: 'The Hero', showLabel: true, visionFt: 60, dmNotes: 'secret' })
    expect(token(id)).toMatchObject({
      label: 'The Hero',
      showLabel: true,
      visionFt: 60,
      dmNotes: 'secret',
    })
    updateItem(id ?? '', { label: '   ', visionFt: 0 })
    expect(token(id)).toMatchObject({ label: null, visionFt: null })
    updateItem(id ?? '', { visionFt: 99999 })
    expect(token(id).visionFt).toBe(1000)
    updateItem(id ?? '', { visionFt: Number.NaN })
    expect(token(id).visionFt).toBeNull()
  })

  it('new heroes see 18 m (60 ft); a token made a player gets it only if it had no vision', () => {
    expect(token(placeToken('hero', { x: 0, y: 0 }, NO_SNAP)).visionFt).toBe(60)
    expect(token(placeToken('goblin', { x: 0, y: 0 }, NO_SNAP)).visionFt).toBeNull()
    expect(token(placeToken('ally', { x: 0, y: 0 }, NO_SNAP)).visionFt).toBeNull()
    const goblin = placeToken('goblin', { x: 0, y: 0 }, NO_SNAP) ?? ''
    updateItem(goblin, { kind: 'player' })
    expect(token(goblin).visionFt).toBe(60)
    const ally = placeToken('ally', { x: 0, y: 0 }, NO_SNAP) ?? ''
    updateItem(ally, { visionFt: 120 })
    updateItem(ally, { kind: 'player' })
    expect(token(ally).visionFt).toBe(120)
    // An explicit radius in the same edit wins.
    const wolf = placeToken('wolf', { x: 0, y: 0 }, NO_SNAP) ?? ''
    updateItem(wolf, { kind: 'player', visionFt: 30 })
    expect(token(wolf).visionFt).toBe(30)
  })

  it('keeps hit points whole and in range; ± clicks are one undo step', () => {
    const id = placeToken('goblin', { x: 0, y: 0 }, NO_SNAP) ?? ''
    updateItem(id, { hp: { current: 7.4, max: 0, publicBar: false } })
    expect(token(id).hp).toStrictEqual({ current: 1, max: 1, publicBar: false })
    updateItem(id, { hp: { current: 7, max: 7, publicBar: true } })
    const steps = useCampaignStore.getState().past.length
    for (let i = 0; i < 3; i++) {
      const hp = token(id).hp
      if (!hp) throw new Error('no hp')
      updateItem(id, { hp: { ...hp, current: hp.current - 1 } }, { coalesceKey: `hp:${id}` })
    }
    expect(token(id).hp?.current).toBe(4)
    expect(useCampaignStore.getState().past).toHaveLength(steps + 1)
    updateItem(id, { hp: { current: -50, max: 7, publicBar: true } })
    expect(token(id).hp?.current).toBe(-7)
  })

  it('deduplicates and caps conditions', () => {
    const id = placeToken('wolf', { x: 0, y: 0 }, NO_SNAP) ?? ''
    updateItem(id, { conditions: ['prone', ' Prone ', 'poisoned', '', 'x'.repeat(100)] })
    expect(token(id).conditions).toStrictEqual(['prone', 'poisoned', 'x'.repeat(64)])
    updateItem(id, { conditions: Array.from({ length: 30 }, (_, i) => `c${i}`) })
    expect(token(id).conditions).toHaveLength(20)
  })
})

describe('fog actions', () => {
  it('fog toggles are undoable', () => {
    setSceneFog({ enabled: true })
    expect(currentScene().fog.enabled).toBe(true)
    undoAction()
    expect(currentScene().fog.enabled).toBe(false)
    redoAction()
    expect(currentScene().fog.enabled).toBe(true)
  })

  it('adds manual edits in order, refusing degenerate shapes; clearing is undoable', () => {
    expect(addFogEdit('reveal', { type: 'rect', x: 0, y: 0, width: 100, height: 50 })).toBe(true)
    expect(addFogEdit('hide', { type: 'rect', x: 0, y: 0, width: 1, height: 50 })).toBe(false)
    expect(addFogEdit('hide', { type: 'polygon', points: [0, 0, 10, 0] })).toBe(false)
    expect(addFogEdit('hide', { type: 'polygon', points: [0, 0, 10, 0, 5, 9] })).toBe(true)
    expect(addFogEdit('reveal', { type: 'brush', points: [5, 5], radius: 20 })).toBe(true)
    expect(addFogEdit('reveal', { type: 'brush', points: [5, Number.NaN], radius: 20 })).toBe(false)
    expect(currentScene().fog.manual.map((e) => [e.mode, e.shape.type])).toStrictEqual([
      ['reveal', 'rect'],
      ['hide', 'polygon'],
      ['reveal', 'brush'],
    ])
    clearFogEdits()
    expect(currentScene().fog.manual).toStrictEqual([])
    undoAction()
    expect(currentScene().fog.manual).toHaveLength(3)
  })

  it('resetting explored memory is not undoable and keeps the scene', () => {
    const sceneId = getCampaign().activeSceneId
    setUnrecorded((draft) => {
      const memory = draft.sceneMemory[sceneId]
      if (memory) memory.explored.chunks['0,0'] = 'AQ=='
    })
    resetExplored()
    expect(getCampaign().sceneMemory[sceneId]?.explored.chunks).toStrictEqual({})
    expect(useCampaignStore.getState().past).toStrictEqual([])
  })

  it('NPC vision is a campaign setting, outside undo', () => {
    setNpcVision(true)
    expect(getCampaign().settings.npcVision).toBe(true)
    expect(useCampaignStore.getState().past).toStrictEqual([])
  })
})
