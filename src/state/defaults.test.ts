import { describe, expect, it } from 'vitest'
import { createCampaign, createScene, createSceneMemory, DEFAULT_GRID_SIZE } from './defaults'
import { CURRENT_SCHEMA_VERSION, migrateToCurrent } from './migrations'

function counterIds() {
  let n = 0
  return () => `id-${++n}`
}

describe('createCampaign', () => {
  it('creates a current-version campaign with one active scene', () => {
    const campaign = createCampaign('Tuesday group', { id: counterIds(), now: () => 1000 })
    expect(campaign.version).toBe(CURRENT_SCHEMA_VERSION)
    expect(campaign.name).toBe('Tuesday group')
    expect(campaign.scenes).toHaveLength(1)
    expect(campaign.activeSceneId).toBe(campaign.scenes[0]?.id)
    expect(campaign.id).not.toBe(campaign.activeSceneId)
    expect(campaign.createdAt).toBe(1000)
    expect(campaign.updatedAt).toBe(1000)
    expect(Object.keys(campaign.sceneMemory)).toEqual([campaign.activeSceneId])
    expect(campaign.presentation.cameraMode).toBe('pushed')
    expect(campaign.settings.diagonalRule).toBe('five')
  })

  it('is plain JSON that survives a save/load round trip', () => {
    const campaign = createCampaign()
    const reloaded = migrateToCurrent(JSON.parse(JSON.stringify(campaign)))
    expect(reloaded).toStrictEqual(campaign)
  })

  it('does not share mutable defaults between campaigns', () => {
    const a = createCampaign()
    const b = createCampaign()
    a.settings.snapEnabled = false
    expect(b.settings.snapEnabled).toBe(true)
  })
})

describe('createScene', () => {
  it('locks the map layer; its memory starts with a quarter-cell explored mask', () => {
    const scene = createScene('Cellar')
    expect(scene.layerState.map.locked).toBe(true)
    expect(scene.layerState.props.locked).toBe(false)
    expect(scene.layerState.tokens.locked).toBe(false)
    expect(scene.grid.size).toBe(DEFAULT_GRID_SIZE)
    expect(scene.grid.feetPerCell).toBe(5)
    expect(scene.fog.enabled).toBe(false)
    const memory = createSceneMemory(scene)
    expect(memory.explored).toStrictEqual({ cellPx: DEFAULT_GRID_SIZE / 4, chunks: {} })
    expect(memory.playerView).toBeNull()
  })
})
