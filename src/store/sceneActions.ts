import { createScene, createSceneMemory } from '../state/defaults'
import { newId } from '../state/ids'
import type { CampaignState, Id, Scene, SceneMemory } from '../state/types'
import { commit, getCampaign, setUnrecorded } from './campaign'
import { notify } from './ui'

/**
 * Scene list actions (SPEC §5.10). Adding, renaming, duplicating, deleting and
 * reordering scenes are undoable; switching the active scene is not. A new or
 * duplicated scene's memory is created in the same recipe (applied, never
 * undone), and a deleted scene keeps its memory so undo restores it intact.
 * The UI reacts to activeSceneId changes through sceneSwitched (DmApp).
 */

export const MAX_SCENE_NAME = 200

function nextSceneName(scenes: readonly Scene[]): string {
  const used = new Set(scenes.map((scene) => scene.name))
  let n = scenes.length + 1
  while (used.has(`Scene ${n}`)) n++
  return `Scene ${n}`
}

function copyName(name: string, scenes: readonly Scene[]): string {
  const base = name.replace(/ \(copy(?: \d+)?\)$/, '')
  const used = new Set(scenes.map((scene) => scene.name))
  let candidate = `${base} (copy)`
  for (let n = 2; used.has(candidate); n++) candidate = `${base} (copy ${n})`
  return candidate.slice(0, MAX_SCENE_NAME)
}

function indexOfScene(campaign: CampaignState, id: Id): number {
  return campaign.scenes.findIndex((scene) => scene.id === id)
}

/** Adds an empty scene after the active one and switches to it. */
export function addScene(): Id {
  const campaign = getCampaign()
  const scene = createScene(nextSceneName(campaign.scenes))
  const at = indexOfScene(campaign, campaign.activeSceneId) + 1
  commit(`Add ${scene.name}`, (draft) => {
    draft.scenes.splice(at, 0, scene)
    draft.sceneMemory[scene.id] = createSceneMemory(scene)
    draft.activeSceneId = scene.id
  })
  return scene.id
}

export function switchScene(id: Id): void {
  const campaign = getCampaign()
  if (id === campaign.activeSceneId || indexOfScene(campaign, id) < 0) return
  setUnrecorded((draft) => {
    draft.activeSceneId = id
  })
}

export function renameScene(id: Id, name: string): void {
  const trimmed = name.trim().slice(0, MAX_SCENE_NAME)
  if (trimmed === '') return
  commit(`Rename scene to ${trimmed}`, (draft) => {
    const scene = draft.scenes.find((s) => s.id === id)
    if (scene) scene.name = trimmed
  })
}

/**
 * A deep copy with new ids for the scene and everything in it (items, fog
 * edits, initiative entries, templates); initiative links follow the copies.
 */
export function copyScene(scene: Scene, name: string): Scene {
  const copy = structuredClone(scene)
  const tokenIds = new Map<Id, Id>()
  copy.id = newId()
  copy.name = name
  for (const item of copy.layers.map) item.id = newId()
  for (const item of copy.layers.props) item.id = newId()
  for (const token of copy.layers.tokens) {
    const id = newId()
    tokenIds.set(token.id, id)
    token.id = id
  }
  for (const edit of copy.fog.manual) edit.id = newId()
  const entryIds = new Map<Id, Id>()
  for (const entry of copy.initiative.entries) {
    const id = newId()
    entryIds.set(entry.id, id)
    entry.id = id
    if (entry.tokenId !== null) entry.tokenId = tokenIds.get(entry.tokenId) ?? entry.tokenId
  }
  const active = copy.initiative.activeEntryId
  copy.initiative.activeEntryId = active === null ? null : (entryIds.get(active) ?? null)
  for (const template of copy.templates) template.id = newId()
  return copy
}

/** Duplicates a scene (with its explored fog and pushed view) right after it and switches to it. */
export function duplicateScene(id: Id): Id | null {
  const campaign = getCampaign()
  const index = indexOfScene(campaign, id)
  const source = campaign.scenes[index]
  if (!source) return null
  const copy = copyScene(source, copyName(source.name, campaign.scenes))
  const memory: SceneMemory = structuredClone(
    campaign.sceneMemory[source.id] ?? createSceneMemory(source),
  )
  commit(`Duplicate ${source.name}`, (draft) => {
    draft.scenes.splice(index + 1, 0, copy)
    draft.sceneMemory[copy.id] = memory
    draft.activeSceneId = copy.id
  })
  return copy.id
}

/** Deletes a scene (the last one cannot go). The active scene moves to a neighbour. */
export function deleteScene(id: Id): boolean {
  const campaign = getCampaign()
  const index = indexOfScene(campaign, id)
  const scene = campaign.scenes[index]
  if (!scene) return false
  if (campaign.scenes.length === 1) {
    notify('A campaign needs at least one scene.')
    return false
  }
  const neighbour = campaign.scenes[index + 1] ?? campaign.scenes[index - 1]
  commit(`Delete ${scene.name}`, (draft) => {
    draft.scenes.splice(index, 1)
    if (draft.activeSceneId === id && neighbour) draft.activeSceneId = neighbour.id
  })
  return true
}

/** Moves a scene one place left (-1) or right (+1) in the scene list. */
export function moveScene(id: Id, delta: -1 | 1): void {
  const campaign = getCampaign()
  const from = indexOfScene(campaign, id)
  const to = from + delta
  const scene = campaign.scenes[from]
  if (!scene || to < 0 || to >= campaign.scenes.length) return
  commit(`Move ${scene.name}`, (draft) => {
    const [moved] = draft.scenes.splice(from, 1)
    if (moved) draft.scenes.splice(to, 0, moved)
  })
}
