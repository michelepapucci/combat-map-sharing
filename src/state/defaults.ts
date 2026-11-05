import { newId } from './ids'
import { CURRENT_SCHEMA_VERSION } from './migrations'
import type { CampaignState, Grid, Scene, SceneMemory, Settings } from './types'

/** Default cell size in world px for a new scene (the DM calibrates it to the map, SPEC §5.1). */
export const DEFAULT_GRID_SIZE = 70

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  diagonalRule: 'five',
  aoeCoverage: 'center',
  snapEnabled: true,
  shareRuler: false,
  npcVision: false,
}

export function createGrid(): Grid {
  return {
    type: 'square',
    size: DEFAULT_GRID_SIZE,
    offsetX: 0,
    offsetY: 0,
    feetPerCell: 5,
    visible: true,
    color: '#000000',
    opacity: 0.35,
  }
}

export interface FactoryOptions {
  id?: () => string
  now?: () => number
}

export function createScene(name: string, { id = newId }: FactoryOptions = {}): Scene {
  return {
    id: id(),
    name,
    grid: createGrid(),
    layers: { map: [], props: [], tokens: [] },
    layerState: {
      // The map layer starts locked so it is not dragged by accident (SPEC §5.3).
      map: { locked: true, visible: true },
      props: { locked: false, visible: true },
      tokens: { locked: false, visible: true },
    },
    fog: { enabled: false, exploredEnabled: true, manual: [] },
    initiative: { entries: [], activeEntryId: null, round: 1, visibleToPlayers: false },
    templates: [],
  }
}

/** The undo-exempt companion of a scene (CampaignState.sceneMemory[scene.id]). */
export function createSceneMemory(scene: Pick<Scene, 'grid'>): SceneMemory {
  return {
    explored: { cellPx: scene.grid.size / 4, chunks: {} },
    playerView: null,
  }
}

export function createCampaign(
  name = 'New campaign',
  { id = newId, now = Date.now }: FactoryOptions = {},
): CampaignState {
  const scene = createScene('Scene 1', { id })
  const timestamp = now()
  return {
    version: CURRENT_SCHEMA_VERSION,
    id: id(),
    name,
    scenes: [scene],
    activeSceneId: scene.id,
    sceneMemory: { [scene.id]: createSceneMemory(scene) },
    library: [],
    settings: { ...DEFAULT_SETTINGS },
    presentation: {
      cameraMode: 'pushed',
      blackout: false,
      splashAssetId: null,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}
