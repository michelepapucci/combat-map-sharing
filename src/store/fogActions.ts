import { createSceneMemory } from '../state/defaults'
import { newId } from '../state/ids'
import type { Point } from '../geometry/types'
import type { FogEditMode, FogShape } from '../state/types'
import { commit, getCampaign, setUnrecorded } from './campaign'

/**
 * Fog of war actions (SPEC §5.6). Fog toggles and manual edits are part of the
 * scene, so they are undoable; explored memory and settings are not.
 */

export type FogBrushShape = FogShape['type']

/** Turns fog or explored memory on or off for the active scene. */
export function setSceneFog(patch: { enabled?: boolean; exploredEnabled?: boolean }): void {
  const words: string[] = []
  if (patch.enabled !== undefined) words.push(patch.enabled ? 'Turn on fog' : 'Turn off fog')
  if (patch.exploredEnabled !== undefined) {
    words.push(
      patch.exploredEnabled ? 'Remember explored areas' : 'Stop remembering explored areas',
    )
  }
  commit(words.join(', '), (draft) => {
    const scene = draft.scenes.find((s) => s.id === draft.activeSceneId)
    if (!scene) return
    if (patch.enabled !== undefined) scene.fog.enabled = patch.enabled
    if (patch.exploredEnabled !== undefined) scene.fog.exploredEnabled = patch.exploredEnabled
  })
}

/** Minimum size of a manual edit (world px): smaller ones are slips of the mouse. */
const MIN_EDIT_PX = 2

function finite(values: readonly number[]): boolean {
  return values.every(Number.isFinite)
}

/** Flat coordinates: finite, in pairs, at least `min` numbers. */
function validPoints(points: readonly number[], min: number): boolean {
  return points.length >= min && points.length % 2 === 0 && finite(points)
}

/** A fresh copy of a shape the validator accepts, or null for a degenerate one. */
function cleanShape(shape: FogShape): FogShape | null {
  switch (shape.type) {
    case 'rect': {
      const { x, y, width, height } = shape
      const ok = finite([x, y, width, height]) && width >= MIN_EDIT_PX && height >= MIN_EDIT_PX
      return ok ? { type: 'rect', x, y, width, height } : null
    }
    case 'polygon':
      return validPoints(shape.points, 6) ? { type: 'polygon', points: [...shape.points] } : null
    case 'brush':
      return validPoints(shape.points, 2) && Number.isFinite(shape.radius) && shape.radius > 0
        ? { type: 'brush', points: [...shape.points], radius: shape.radius }
        : null
  }
}

/** Adds a manual reveal or hide (undoable). Returns false for degenerate shapes. */
export function addFogEdit(mode: FogEditMode, shape: FogShape): boolean {
  const clean = cleanShape(shape)
  if (!clean) return false
  const edit = { id: newId(), mode, shape: clean }
  commit(mode === 'reveal' ? 'Reveal area' : 'Hide area', (draft) => {
    draft.scenes.find((s) => s.id === draft.activeSceneId)?.fog.manual.push(edit)
  })
  return true
}

/** Removes every manual fog edit of the active scene (undoable). */
export function clearFogEdits(): void {
  commit('Clear manual fog', (draft) => {
    const scene = draft.scenes.find((s) => s.id === draft.activeSceneId)
    if (scene && scene.fog.manual.length > 0) scene.fog.manual = []
  })
}

/** Forgets what players have explored in the active scene (not undoable: confirm first). */
export function resetExplored(): void {
  const campaign = getCampaign()
  const scene = campaign.scenes.find((s) => s.id === campaign.activeSceneId)
  if (!scene) return
  const fresh = createSceneMemory(scene)
  setUnrecorded((draft) => {
    const memory = (draft.sceneMemory[scene.id] ??= fresh)
    memory.explored = fresh.explored
  })
}

export function setNpcVision(npcVision: boolean): void {
  setUnrecorded((draft) => {
    draft.settings.npcVision = npcVision
  })
}

/** Flat [x0, y0, x1, y1, ...] from points. */
export function flatPoints(points: readonly Point[]): number[] {
  return points.flatMap((p) => [p.x, p.y])
}
