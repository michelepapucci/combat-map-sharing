import { beforeEach, describe, expect, it } from 'vitest'
import { createCampaign } from '../state/defaults'
import type { AoeTemplate } from '../state/types'
import { currentScene, redoAction, undoAction } from './actions'
import { affectedBy, affectedText } from '../dm/canvas/affected'
import { getCampaign, loadCampaign, setUnrecorded, useCampaignStore } from './campaign'
import {
  cleanTemplateFeet,
  deleteTemplates,
  moveTemplates,
  nudgeTemplates,
  pinTemplate,
  selectedTemplateIds,
  setAoeCoverage,
  setShareRuler,
  setTemplateShape,
  toggleTemplatesVisible,
  updateTemplate,
} from './templateActions'
import { initialUiState, setTool, useUiStore } from './ui'

function temp(patch: Partial<AoeTemplate> = {}): AoeTemplate {
  return {
    id: 'temp-1',
    shape: 'cone',
    originX: 70,
    originY: 140,
    sizeFt: 15,
    widthFt: 5,
    directionDeg: 30,
    color: '#ef4444',
    visibleToPlayers: true,
    ...patch,
  }
}

function pinned(): AoeTemplate[] {
  return currentScene().templates
}

beforeEach(() => {
  loadCampaign(createCampaign('Test'))
  useUiStore.setState(initialUiState())
})

describe('templates', () => {
  it('sizes are whole 5 ft steps within limits', () => {
    expect([12, 13, 0, -20, 2400, Number.NaN].map(cleanTemplateFeet)).toStrictEqual([
      10, 15, 5, 5, 1000, 5,
    ])
  })

  it('pinning moves the template being placed into the scene, selected, undoably', () => {
    useUiStore.setState({ tool: 'aoe', tempTemplate: temp({ sizeFt: 17, directionDeg: -90 }) })
    const id = pinTemplate()
    expect(id).toBe('temp-1')
    expect(pinned()).toStrictEqual([temp({ sizeFt: 15, directionDeg: 270 })])
    expect(useUiStore.getState()).toMatchObject({ tempTemplate: null, selection: ['temp-1'] })
    undoAction()
    expect(pinned()).toStrictEqual([])
    redoAction()
    expect(pinned()).toHaveLength(1)
    expect(pinTemplate()).toBeNull() // nothing being placed
  })

  it('a template being placed vanishes when the tool changes', () => {
    useUiStore.setState({ tool: 'aoe', tempTemplate: temp() })
    setTool('aoe')
    expect(useUiStore.getState().tempTemplate).not.toBeNull()
    setTool('select')
    expect(useUiStore.getState().tempTemplate).toBeNull()
  })

  it('edits, moves, hides and deletes pinned templates', () => {
    useUiStore.setState({ tempTemplate: temp() })
    pinTemplate()
    updateTemplate('temp-1', { sizeFt: 32, widthFt: 0, directionDeg: 725, color: 'red' })
    expect(pinned()[0]).toMatchObject({ sizeFt: 30, widthFt: 5, directionDeg: 5, color: '#ef4444' })
    moveTemplates({ 'temp-1': { x: 210, y: 0 }, unknown: { x: 1, y: 1 } })
    expect(pinned()[0]).toMatchObject({ originX: 210, originY: 0 })
    moveTemplates({ 'temp-1': { x: Number.NaN, y: 0 } })
    expect(pinned()[0]?.originX).toBe(210)
    toggleTemplatesVisible(['temp-1'])
    expect(pinned()[0]?.visibleToPlayers).toBe(false)
    toggleTemplatesVisible(['temp-1'])
    expect(pinned()[0]?.visibleToPlayers).toBe(true)
    expect(selectedTemplateIds(currentScene(), ['temp-1', 'not-a-template'])).toStrictEqual([
      'temp-1',
    ])
    deleteTemplates(['temp-1'])
    expect(pinned()).toStrictEqual([])
    expect(useUiStore.getState().selection).toStrictEqual([])
  })

  it('a shape change re-snaps the origin and keeps cubes axis-aligned', () => {
    // A sphere centered on a square (half-cell lattice), at a free angle.
    useUiStore.setState({
      tempTemplate: temp({ shape: 'circle', originX: 105, originY: 105, directionDeg: 37 }),
    })
    pinTemplate()
    setTemplateShape('temp-1', 'cube')
    expect(pinned()[0]).toMatchObject({
      shape: 'cube',
      originX: 140,
      originY: 140,
      directionDeg: 45,
    })
    setTemplateShape('temp-1', 'line')
    expect(pinned()[0]).toMatchObject({ shape: 'line', originX: 175, originY: 140 })
    undoAction()
    expect(pinned()[0]?.shape).toBe('cube')
    // Snapping off: the origin stays where it is.
    setUnrecorded((draft) => {
      draft.settings.snapEnabled = false
    })
    setTemplateShape('temp-1', 'circle')
    expect(pinned()[0]).toMatchObject({ shape: 'circle', originX: 140, originY: 140 })
  })

  it('arrow keys move selected templates; repeated presses are one undo step', () => {
    useUiStore.setState({ tempTemplate: temp() })
    pinTemplate()
    const steps = useCampaignStore.getState().past.length
    nudgeTemplates(['temp-1'], 70, 0)
    nudgeTemplates(['temp-1'], 70, 0)
    expect(pinned()[0]).toMatchObject({ originX: 210, originY: 140 })
    expect(useCampaignStore.getState().past).toHaveLength(steps + 1)
  })

  it('counts are cached, and huge templates say they cannot be counted', () => {
    const grid = { size: 70, offsetX: 0, offsetY: 0, feetPerCell: 5 }
    const tokens = [{ id: 'goblin', x: 105, y: 35, width: 70, height: 70 }]
    const small = affectedBy(
      temp({ shape: 'circle', originX: 0, originY: 0, sizeFt: 10 }),
      grid,
      'center',
      tokens,
    )
    expect(affectedText(small)).toBe('12 squares, 1 token affected')
    const huge = affectedBy(
      temp({ shape: 'circle', sizeFt: 1000 }),
      { ...grid, feetPerCell: 1 },
      'center',
      tokens,
    )
    expect(huge.tooLarge).toBe(true)
    expect(affectedText(huge)).toBe('Too large to count the squares it affects')
  })

  it('ruler sharing and the coverage rule are settings outside undo', () => {
    setShareRuler(true)
    setAoeCoverage('half')
    expect(getCampaign().settings).toMatchObject({ shareRuler: true, aoeCoverage: 'half' })
    expect(useCampaignStore.getState().past).toStrictEqual([])
  })
})
