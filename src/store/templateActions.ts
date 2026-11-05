import type { Draft } from 'immer'
import type { Point } from '../geometry/types'
import type {
  AoeCoverageRule,
  AoeShape,
  AoeTemplate,
  CampaignState,
  Id,
  Scene,
} from '../state/types'
import { snapTemplateOrigin } from '../geometry/aoe'
import { mod } from '../geometry/grid'
import { currentScene } from './actions'
import { commit, getCampaign, setUnrecorded } from './campaign'
import { notify, setSelection, useUiStore } from './ui'

/**
 * Area-of-effect templates (SPEC §5.5). The one being placed is transient
 * (`ui.tempTemplate`, gone when the tool changes); pinning copies it into the
 * scene, where it can be selected, moved, edited and deleted, every change an
 * undoable step.
 */

/** Template sizes and line widths the editor accepts (feet). */
export const MIN_TEMPLATE_FT = 5
export const MAX_TEMPLATE_FT = 1000

/** Colors offered for templates. */
export const TEMPLATE_COLORS = [
  { value: '#f59e0b', name: 'Amber' },
  { value: '#ef4444', name: 'Red' },
  { value: '#3b82f6', name: 'Blue' },
  { value: '#22c55e', name: 'Green' },
  { value: '#a855f7', name: 'Purple' },
  { value: '#e5e7eb', name: 'White' },
] as const

function sceneOf(draft: Draft<CampaignState>): Draft<Scene> {
  const scene = draft.scenes.find((s) => s.id === draft.activeSceneId)
  if (!scene) throw new Error('Active scene not found')
  return scene
}

/** A length in feet: a whole multiple of 5 ft, within the limits. */
export function cleanTemplateFeet(feet: number): number {
  if (!Number.isFinite(feet)) return MIN_TEMPLATE_FT
  const snapped = Math.round(feet / 5) * 5
  return Math.min(MAX_TEMPLATE_FT, Math.max(MIN_TEMPLATE_FT, snapped))
}

function cleanDirection(degrees: number): number {
  return Number.isFinite(degrees) ? mod(degrees, 360) : 0
}

export function isHexColor(color: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(color)
}

export function findTemplate(scene: Scene, id: Id): AoeTemplate | null {
  return scene.templates.find((template) => template.id === id) ?? null
}

/** The selected ids that are templates of the active scene. */
export function selectedTemplateIds(scene: Scene, ids: readonly Id[]): Id[] {
  const templates = new Set(scene.templates.map((template) => template.id))
  return ids.filter((id) => templates.has(id))
}

/**
 * A template switched to another shape: cubes turn axis-aligned (their diagonal
 * at 45° + k·90°, the nearest to the old direction), and the origin snaps where
 * the new shape snaps (unless snapping is off), so a sphere turned into a cube
 * lands on whole squares.
 */
export function reshaped<
  T extends Pick<AoeTemplate, 'shape' | 'originX' | 'originY' | 'directionDeg'>,
>(template: T, shape: AoeShape, grid: Scene['grid']): T {
  const directionDeg =
    shape === 'cube'
      ? mod(Math.round((template.directionDeg - 45) / 90) * 90 + 45, 360)
      : template.directionDeg
  const origin = getCampaign().settings.snapEnabled
    ? snapTemplateOrigin(shape, { x: template.originX, y: template.originY }, grid)
    : { x: template.originX, y: template.originY }
  return { ...template, shape, directionDeg, originX: origin.x, originY: origin.y }
}

/** Changes a pinned template's shape (see reshaped). */
export function setTemplateShape(id: Id, shape: AoeShape): void {
  const scene = currentScene()
  const template = findTemplate(scene, id)
  if (!template || template.shape === shape) return
  const next = reshaped(template, shape, scene.grid)
  commit('Edit template', (draft) => {
    const target = sceneOf(draft).templates.find((t) => t.id === id)
    if (!target) return
    target.shape = next.shape
    target.directionDeg = next.directionDeg
    target.originX = next.originX
    target.originY = next.originY
  })
}

/** Arrow keys on selected templates: moves their origins (repeated presses are one undo step). */
export function nudgeTemplates(ids: readonly Id[], dx: number, dy: number): void {
  const scene = currentScene()
  const set = new Set(selectedTemplateIds(scene, ids))
  if (set.size === 0 || !Number.isFinite(dx + dy)) return
  commit(
    set.size === 1 ? 'Move template' : `Move ${set.size} templates`,
    (draft) => {
      for (const template of sceneOf(draft).templates) {
        if (!set.has(template.id)) continue
        template.originX += dx
        template.originY += dy
      }
    },
    { coalesceKey: `nudge-templates:${[...set].join(',')}` },
  )
}

/** Pins the template being placed: it joins the scene and becomes the selection. */
export function pinTemplate(): Id | null {
  const temp = useUiStore.getState().tempTemplate
  if (!temp) return null
  const template: AoeTemplate = {
    id: temp.id,
    shape: temp.shape,
    originX: temp.originX,
    originY: temp.originY,
    sizeFt: cleanTemplateFeet(temp.sizeFt),
    widthFt: cleanTemplateFeet(temp.widthFt),
    directionDeg: cleanDirection(temp.directionDeg),
    color: isHexColor(temp.color) ? temp.color : TEMPLATE_COLORS[0].value,
    visibleToPlayers: temp.visibleToPlayers,
  }
  if (![template.originX, template.originY].every(Number.isFinite)) return null
  // Drop the transient copy first: nothing (the projection) may ever see both at once.
  useUiStore.setState({ tempTemplate: null })
  commit('Pin template', (draft) => {
    sceneOf(draft).templates.push(template)
  })
  setSelection([template.id])
  notify('Template pinned: select it to move, edit or delete it.', 'success')
  return template.id
}

export interface TemplatePatch {
  shape?: AoeShape
  sizeFt?: number
  widthFt?: number
  directionDeg?: number
  color?: string
  visibleToPlayers?: boolean
}

/** Edits a pinned template (sliders and pickers coalesce through `coalesceKey`). */
export function updateTemplate(
  id: Id,
  patch: TemplatePatch,
  options: { coalesceKey?: string } = {},
): void {
  commit(
    'Edit template',
    (draft) => {
      const template = sceneOf(draft).templates.find((t) => t.id === id)
      if (!template) return
      if (patch.shape !== undefined) template.shape = patch.shape
      if (patch.sizeFt !== undefined) template.sizeFt = cleanTemplateFeet(patch.sizeFt)
      if (patch.widthFt !== undefined) template.widthFt = cleanTemplateFeet(patch.widthFt)
      if (patch.directionDeg !== undefined) {
        template.directionDeg = cleanDirection(patch.directionDeg)
      }
      if (patch.color !== undefined && isHexColor(patch.color)) template.color = patch.color
      if (patch.visibleToPlayers !== undefined) template.visibleToPlayers = patch.visibleToPlayers
    },
    options,
  )
}

/** Moves pinned templates' origins (a drag commits once, on drop). */
export function moveTemplates(origins: Readonly<Record<Id, Point>>): void {
  const entries = Object.entries(origins).filter(
    ([, p]) => Number.isFinite(p.x) && Number.isFinite(p.y),
  )
  if (entries.length === 0) return
  commit(entries.length === 1 ? 'Move template' : `Move ${entries.length} templates`, (draft) => {
    const scene = sceneOf(draft)
    for (const [id, p] of entries) {
      const template = scene.templates.find((t) => t.id === id)
      if (template) {
        template.originX = p.x
        template.originY = p.y
      }
    }
  })
}

export function deleteTemplates(ids: readonly Id[]): void {
  const set = new Set(selectedTemplateIds(currentScene(), ids))
  if (set.size === 0) return
  commit(set.size === 1 ? 'Delete template' : `Delete ${set.size} templates`, (draft) => {
    const scene = sceneOf(draft)
    scene.templates = scene.templates.filter((t) => !set.has(t.id))
  })
  setSelection(useUiStore.getState().selection.filter((id) => !set.has(id)))
}

/** H on templates: hides them from players if any is shown, otherwise shows them all. */
export function toggleTemplatesVisible(ids: readonly Id[]): void {
  const scene = currentScene()
  const set = new Set(selectedTemplateIds(scene, ids))
  if (set.size === 0) return
  const show = !scene.templates.some((t) => set.has(t.id) && t.visibleToPlayers)
  commit(show ? 'Show templates to players' : 'Hide templates from players', (draft) => {
    for (const template of sceneOf(draft).templates) {
      if (set.has(template.id)) template.visibleToPlayers = show
    }
  })
}

/** "Share ruler with players" (SPEC §5.4): a campaign setting, outside undo. */
export function setShareRuler(shareRuler: boolean): void {
  setUnrecorded((draft) => {
    draft.settings.shareRuler = shareRuler
  })
}

/** Which squares a template affects (SPEC §5.5): a campaign setting, outside undo. */
export function setAoeCoverage(aoeCoverage: AoeCoverageRule): void {
  setUnrecorded((draft) => {
    draft.settings.aoeCoverage = aoeCoverage
  })
}
