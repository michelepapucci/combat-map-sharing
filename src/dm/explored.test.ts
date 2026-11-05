import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isExplored } from '../geometry/fog'
import { createCampaign } from '../state/defaults'
import type { Point } from '../geometry/types'
import type { Id, TokenKind } from '../state/types'
import { moveItems, nudgeItems, placeToken, toggleHidden, updateItem } from '../store/actions'
import { getCampaign, loadCampaign, setUnrecorded, useCampaignStore } from '../store/campaign'
import {
  addFogEdit,
  clearFogEdits,
  resetExplored,
  setNpcVision,
  setSceneFog,
} from '../store/fogActions'
import { addScene, switchScene } from '../store/sceneActions'
import { initialUiState, useUiStore } from '../store/ui'
import { recordExplored, resetExploredTracking } from './explored'

/**
 * Explored memory as the DM session records it (the presentation runs
 * recordExplored after every campaign change). Default grid: 70 px = 5 ft, so
 * 30 ft of vision is a 420 px radius.
 */

const NO_SNAP = { snap: false }
let stop: () => void = () => {}

function explored(point: Point): boolean {
  const campaign = getCampaign()
  const memory = campaign.sceneMemory[campaign.activeSceneId]
  if (!memory) throw new Error('no scene memory')
  return isExplored(memory.explored, point)
}

/** A token of `kind` with 30 ft of vision, in one step (a placed Hero would see 60 ft first). */
function hero(at: Point = { x: 0, y: 0 }, kind: TokenKind = 'player'): Id {
  const id = placeToken('goblin', at, NO_SNAP)
  if (!id) throw new Error('not placed')
  updateItem(id, { kind, visionFt: 30 })
  return id
}

function setBlackout(blackout: boolean): void {
  setUnrecorded((draft) => {
    draft.presentation.blackout = blackout
  })
}

beforeEach(() => {
  resetExploredTracking()
  loadCampaign(createCampaign('Test'))
  useUiStore.setState(initialUiState())
  stop = useCampaignStore.subscribe((state, previous) => {
    if (state.campaign !== previous.campaign) recordExplored()
  })
})

afterEach(() => stop())

describe('explored memory', () => {
  it('records the vision circles while fog and explored memory are on', () => {
    setSceneFog({ enabled: true })
    hero()
    expect(explored({ x: 400, y: 0 })).toBe(true)
    expect(explored({ x: 0, y: -400 })).toBe(true)
    expect(explored({ x: 500, y: 0 })).toBe(false)
  })

  it('a move sweeps the corridor between the old and new positions', () => {
    setSceneFog({ enabled: true })
    const id = hero()
    moveItems({ [id]: { x: 3000, y: 0 } })
    expect(explored({ x: 1500, y: 0 })).toBe(true)
    expect(explored({ x: 1500, y: 400 })).toBe(true)
    expect(explored({ x: 1500, y: 500 })).toBe(false)
    expect(explored({ x: 3400, y: 0 })).toBe(true)
  })

  it('nothing while fog is off; turning it on records the current circles only', () => {
    const id = hero()
    moveItems({ [id]: { x: 3000, y: 0 } })
    expect(explored({ x: 0, y: 0 })).toBe(false)
    setSceneFog({ enabled: true })
    expect(explored({ x: 3000, y: 0 })).toBe(true)
    expect(explored({ x: 1500, y: 0 })).toBe(false)
    expect(explored({ x: 0, y: 0 })).toBe(false)
  })

  it('nothing while explored memory is off', () => {
    setSceneFog({ enabled: true, exploredEnabled: false })
    const id = hero()
    nudgeItems([id], 70, 0)
    expect(explored({ x: 0, y: 0 })).toBe(false)
  })

  it('blackout records nothing; lifting it records circles, not the corridor', () => {
    setSceneFog({ enabled: true })
    const id = hero()
    setBlackout(true)
    moveItems({ [id]: { x: 3000, y: 0 } })
    expect(explored({ x: 3000, y: 0 })).toBe(false)
    setBlackout(false)
    expect(explored({ x: 3000, y: 0 })).toBe(true)
    expect(explored({ x: 1500, y: 0 })).toBe(false)
  })

  it('enemies, hidden heroes and NPCs without NPC vision reveal nothing', () => {
    setSceneFog({ enabled: true })
    hero({ x: 0, y: 0 }, 'enemy')
    hero({ x: 1000, y: 0 }, 'npc')
    const hidden = placeToken('goblin', { x: 2000, y: 0 }, NO_SNAP) ?? ''
    toggleHidden([hidden])
    updateItem(hidden, { kind: 'player', visionFt: 30 })
    expect([0, 1000, 2000].map((x) => explored({ x, y: 0 }))).toStrictEqual([false, false, false])
    setNpcVision(true)
    expect(explored({ x: 1000, y: 0 })).toBe(true)
    toggleHidden([hidden])
    expect(explored({ x: 2000, y: 0 })).toBe(true)
    expect(explored({ x: 0, y: 0 })).toBe(false)
  })

  it('reset keeps only what players see now; undo never brings memory back', () => {
    setSceneFog({ enabled: true })
    const id = hero()
    moveItems({ [id]: { x: 3000, y: 0 } })
    resetExplored()
    expect(explored({ x: 0, y: 0 })).toBe(false)
    expect(explored({ x: 3000, y: 0 })).toBe(true)
  })

  it('ground under a manual hide is never explored, even after the hide is cleared', () => {
    setSceneFog({ enabled: true })
    // A secret room east of the hero, hidden by hand.
    addFogEdit('hide', { type: 'rect', x: 200, y: -200, width: 400, height: 400 })
    const id = hero()
    expect(explored({ x: 300, y: 0 })).toBe(false)
    expect(explored({ x: -300, y: 0 })).toBe(true)
    // The hero walks away west; the DM then clears the manual fog.
    moveItems({ [id]: { x: -3000, y: 0 } })
    clearFogEdits()
    expect(explored({ x: 300, y: 0 })).toBe(false)
    expect(explored({ x: -1500, y: 0 })).toBe(true)
  })

  it('clearing a hide records what the heroes see there now', () => {
    setSceneFog({ enabled: true })
    addFogEdit('hide', { type: 'rect', x: 200, y: -200, width: 400, height: 400 })
    const id = hero()
    clearFogEdits()
    expect(explored({ x: 300, y: 0 })).toBe(true)
    moveItems({ [id]: { x: -3000, y: 0 } })
    expect(explored({ x: 300, y: 0 })).toBe(true)
  })

  it('manual reveals are remembered as explored', () => {
    setSceneFog({ enabled: true })
    addFogEdit('reveal', { type: 'rect', x: 5000, y: 0, width: 200, height: 200 })
    expect(explored({ x: 5100, y: 100 })).toBe(true)
    clearFogEdits()
    expect(explored({ x: 5100, y: 100 })).toBe(true)
  })

  it('each scene remembers its own explored ground', () => {
    setSceneFog({ enabled: true })
    const first = getCampaign().activeSceneId
    hero()
    addScene()
    const second = getCampaign().activeSceneId
    expect(second).not.toBe(first)
    setSceneFog({ enabled: true })
    hero({ x: 5000, y: 0 })
    expect(explored({ x: 5000, y: 0 })).toBe(true)
    expect(explored({ x: 0, y: 0 })).toBe(false)
    switchScene(first)
    expect(explored({ x: 0, y: 0 })).toBe(true)
    expect(explored({ x: 5000, y: 0 })).toBe(false)
  })
})
