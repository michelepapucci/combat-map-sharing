import type { Draft } from 'immer'
import { effectiveVisibility, sortInitiative } from '../geometry/initiative'
import { newId } from '../state/ids'
import type {
  CampaignState,
  Id,
  Initiative,
  InitiativeEntry,
  InitiativeVisibility,
  Scene,
  Token,
} from '../state/types'
import { MAX_NAME_LENGTH } from '../state/validate'
import { currentScene } from './actions'
import { projectForPlayers } from '../projection/projectForPlayers'
import { commit, getCampaign } from './campaign'
import { useDevicePrefs } from './devicePrefs'
import { useSessionStore } from './session'
import { notify, useUiStore } from './ui'

/**
 * The initiative tracker (SPEC §5.8, Decision 16). Every change is an undoable
 * step of the active scene. Entries are stored unsorted; the turn order is
 * sortInitiative(entries), and the turn is an entry id, so editing values or
 * re-sorting never moves it.
 */

/** Initiative values the tracker accepts (a d20 roll plus any sane modifier). */
export const MAX_INITIATIVE = 999

function trackerOf(draft: Draft<CampaignState>): Draft<Initiative> {
  const scene = draft.scenes.find((s) => s.id === draft.activeSceneId)
  if (!scene) throw new Error('Active scene not found')
  return scene.initiative
}

function clampValue(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_INITIATIVE, Math.max(-MAX_INITIATIVE, value)) : 0
}

function cleanName(name: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH)
}

/** The player-facing name of a token's entry: its label when shown, otherwise its name. */
export function entryNameFor(token: Pick<Token, 'name' | 'label' | 'showLabel'>): string {
  const label = token.showLabel && token.label?.trim() ? token.label : token.name
  return cleanName(label) || 'Creature'
}

/** An unbiased d20, from crypto.getRandomValues (injectable for tests). */
export function rollD20(random: () => number = cryptoRandom): number {
  return Math.min(20, Math.max(1, Math.floor(random() * 20) + 1))
}

function cryptoRandom(): number {
  // 2^32 is not a multiple of 20: reject the top sliver so every face is equally likely.
  const buffer = new Uint32Array(1)
  const limit = Math.floor(0x1_0000_0000 / 20) * 20
  for (;;) {
    crypto.getRandomValues(buffer)
    const n = buffer[0] ?? 0
    if (n < limit) return (n % 20) / 20
  }
}

function nextManualOrder(entries: readonly InitiativeEntry[]): number {
  return entries.reduce((max, entry) => Math.max(max, entry.manualOrder + 1), 0)
}

function newEntry(
  entries: readonly InitiativeEntry[],
  init: Pick<InitiativeEntry, 'tokenId' | 'name' | 'value' | 'dexTiebreak'>,
): InitiativeEntry {
  return {
    id: newId(),
    tokenId: init.tokenId,
    name: init.name,
    value: init.value,
    dexTiebreak: init.dexTiebreak,
    manualOrder: nextManualOrder(entries),
    visibility: 'auto',
  }
}

function tokensOf(scene: Scene, ids: readonly Id[]): Token[] {
  const wanted = new Set(ids)
  return scene.layers.tokens.filter((token) => wanted.has(token.id))
}

/** Tokens among `ids` that are not in the tracker yet. */
export function tokensNotInInitiative(scene: Scene, ids: readonly Id[]): Token[] {
  const tracked = new Set(scene.initiative.entries.map((entry) => entry.tokenId))
  return tokensOf(scene, ids).filter((token) => !tracked.has(token.id))
}

/** Adds the tokens that are not in the tracker yet (value 0, to be typed in). Returns how many. */
export function addTokensToInitiative(ids: readonly Id[]): number {
  const tokens = tokensNotInInitiative(currentScene(), ids)
  if (tokens.length === 0) return 0
  commit(
    tokens.length === 1 ? 'Add to initiative' : `Add ${tokens.length} to initiative`,
    (draft) => {
      const tracker = trackerOf(draft)
      for (const token of tokens) {
        tracker.entries.push(
          newEntry(tracker.entries, {
            tokenId: token.id,
            name: entryNameFor(token),
            value: 0,
            dexTiebreak: null,
          }),
        )
      }
    },
  )
  return tokens.length
}

/**
 * "Roll for selected enemies" (SPEC §5.8): every selected token that is not a
 * player gets d20 + its initiative modifier, added to the tracker if needed or
 * re-rolled if already there; a missing dex tiebreak takes the modifier (it is
 * usually the Dexterity modifier). Players roll their own dice: selected player
 * tokens are only added. Returns the rolls, for the notice.
 */
export function rollInitiative(
  ids: readonly Id[],
  random: () => number = cryptoRandom,
): { name: string; total: number }[] {
  const scene = currentScene()
  const tokens = tokensOf(scene, ids)
  if (tokens.length === 0) return []
  const rolls = tokens
    .filter((token) => token.kind !== 'player')
    .map((token) => {
      const modifier = token.initiativeModifier ?? 0
      return { token, modifier, total: clampValue(rollD20(random) + modifier) }
    })
  const players = tokens.filter((token) => token.kind === 'player')
  commit('Roll initiative', (draft) => {
    const tracker = trackerOf(draft)
    for (const { token, modifier, total } of rolls) {
      const existing = tracker.entries.find((entry) => entry.tokenId === token.id)
      const dex = token.initiativeModifier === null ? null : modifier
      if (existing) {
        existing.value = total
        existing.dexTiebreak ??= dex
      } else {
        tracker.entries.push(
          newEntry(tracker.entries, {
            tokenId: token.id,
            name: entryNameFor(token),
            value: total,
            dexTiebreak: dex,
          }),
        )
      }
    }
    for (const token of players) {
      if (tracker.entries.some((entry) => entry.tokenId === token.id)) continue
      tracker.entries.push(
        newEntry(tracker.entries, {
          tokenId: token.id,
          name: entryNameFor(token),
          value: 0,
          dexTiebreak: null,
        }),
      )
    }
  })
  const result = rolls.map(({ token, total }) => ({ name: entryNameFor(token), total }))
  if (result.length > 0) {
    notify(`Rolled: ${result.map((roll) => `${roll.name} ${roll.total}`).join(', ')}`)
  }
  return result
}

/** An entry typed by name (a creature without a token, a lair action...). */
export function addNamedEntry(name: string, value: number): boolean {
  const clean = cleanName(name)
  if (clean === '') return false
  commit('Add to initiative', (draft) => {
    const tracker = trackerOf(draft)
    tracker.entries.push(
      newEntry(tracker.entries, {
        tokenId: null,
        name: clean,
        value: clampValue(value),
        dexTiebreak: null,
      }),
    )
  })
  return true
}

export interface EntryPatch {
  name?: string
  value?: number
  dexTiebreak?: number | null
  visibility?: InitiativeVisibility
}

/** Inline edits. An empty name keeps the old one. */
export function updateEntry(id: Id, patch: EntryPatch): void {
  commit('Edit initiative', (draft) => {
    const entry = trackerOf(draft).entries.find((e) => e.id === id)
    if (!entry) return
    if (patch.name !== undefined && cleanName(patch.name) !== '') entry.name = cleanName(patch.name)
    if (patch.value !== undefined) entry.value = clampValue(patch.value)
    if (patch.dexTiebreak !== undefined) {
      entry.dexTiebreak =
        patch.dexTiebreak === null || !Number.isFinite(patch.dexTiebreak)
          ? null
          : clampValue(patch.dexTiebreak)
    }
    if (patch.visibility !== undefined) entry.visibility = patch.visibility
  })
}

/**
 * The per-entry eye toggle: makes players see the entry or not, as an explicit
 * choice; a choice equal to what 'auto' would give (follow the token) is stored
 * as 'auto', so toggling twice returns to following the token.
 */
export function toggleEntryVisibility(id: Id): void {
  const scene = currentScene()
  const entry = scene.initiative.entries.find((e) => e.id === id)
  if (!entry) return
  const now = effectiveVisibility(entry, scene)
  const wanted = now === 'shown' ? 'hidden' : 'shown'
  const auto = effectiveVisibility({ ...entry, visibility: 'auto' }, scene)
  updateEntry(id, { visibility: wanted === auto ? 'auto' : wanted })
}

/** The entry after `id` in turn order, wrapping (null when it is the only one). */
function following(entries: readonly InitiativeEntry[], id: Id): InitiativeEntry | null {
  const sorted = sortInitiative(entries)
  const index = sorted.findIndex((entry) => entry.id === id)
  if (index < 0 || sorted.length < 2) return null
  return sorted[(index + 1) % sorted.length] ?? null
}

export function removeEntry(id: Id): void {
  commit('Remove from initiative', (draft) => {
    const tracker = trackerOf(draft)
    if (tracker.activeEntryId === id) {
      // Its turn ends: the next one starts (a new round when it wraps).
      const sorted = sortInitiative(tracker.entries)
      const index = sorted.findIndex((entry) => entry.id === id)
      const next = following(tracker.entries, id)
      if (next && index === sorted.length - 1) tracker.round += 1
      tracker.activeEntryId = next?.id ?? null
    }
    tracker.entries = tracker.entries.filter((entry) => entry.id !== id)
    // The last one gone: the next combat starts from round 1.
    if (tracker.entries.length === 0) {
      tracker.activeEntryId = null
      tracker.round = 1
    }
  })
}

/** Next turn (N): the first entry starts the combat; after the last, a new round. */
export function nextTurn(): boolean {
  const tracker = currentScene().initiative
  const sorted = sortInitiative(tracker.entries)
  const first = sorted[0]
  if (!first) {
    notify('Add creatures to the initiative tracker first.')
    return false
  }
  const index = sorted.findIndex((entry) => entry.id === tracker.activeEntryId)
  const wraps = index === sorted.length - 1
  const next = index < 0 || wraps ? first : sorted[index + 1]
  if (!next) return false
  commit(index < 0 ? 'Start combat' : 'Next turn', (draft) => {
    const target = trackerOf(draft)
    if (wraps) target.round += 1
    target.activeEntryId = next.id
  })
  return true
}

/** Previous turn (Shift+N): back past the first entry goes to the previous round. */
export function previousTurn(): boolean {
  const tracker = currentScene().initiative
  const sorted = sortInitiative(tracker.entries)
  const index = sorted.findIndex((entry) => entry.id === tracker.activeEntryId)
  if (index < 0) return false
  if (index === 0 && tracker.round <= 1) return false
  const previous = index === 0 ? sorted.at(-1) : sorted[index - 1]
  if (!previous) return false
  commit('Previous turn', (draft) => {
    const target = trackerOf(draft)
    if (index === 0) target.round -= 1
    target.activeEntryId = previous.id
  })
  return true
}

/** Clear / end combat (confirmed by the caller): no entries, no turn, round 1. */
export function endCombat(): void {
  commit('End combat', (draft) => {
    const tracker = trackerOf(draft)
    tracker.entries = []
    tracker.activeEntryId = null
    tracker.round = 1
  })
}

export function setTrackerVisible(visibleToPlayers: boolean): void {
  commit(visibleToPlayers ? 'Show tracker to players' : 'Hide tracker from players', (draft) => {
    trackerOf(draft).visibleToPlayers = visibleToPlayers
  })
}

/** Entries whose order only the manual (drag-and-drop) order decides: same value and tiebreak. */
export function tiedWith(
  entries: readonly InitiativeEntry[],
  entry: InitiativeEntry,
): InitiativeEntry[] {
  return sortInitiative(
    entries.filter((e) => e.value === entry.value && e.dexTiebreak === entry.dexTiebreak),
  )
}

/**
 * Moves an entry among its exact ties (drag-and-drop, or the keyboard): to the
 * position of `targetId`, or one step with `step`. Entries that are not tied
 * cannot be reordered by hand (change the value or tiebreak instead).
 */
export function moveAmongTies(id: Id, to: { targetId: Id } | { step: -1 | 1 }): boolean {
  const entries = currentScene().initiative.entries
  const entry = entries.find((e) => e.id === id)
  if (!entry) return false
  const group = tiedWith(entries, entry)
  const from = group.findIndex((e) => e.id === id)
  const target = 'targetId' in to ? group.findIndex((e) => e.id === to.targetId) : from + to.step
  if (target < 0 || target >= group.length || target === from) return false
  const order = group.map((e) => e.id)
  order.splice(from, 1)
  order.splice(target, 0, id)
  // Keep the group's own manualOrder values, reassigned in the new order, so it
  // stays after or before other entries exactly as before.
  const slots = group.map((e) => e.manualOrder).toSorted((a, b) => a - b)
  commit('Reorder initiative', (draft) => {
    const tracker = trackerOf(draft)
    order.forEach((entryId, i) => {
      const moved = tracker.entries.find((e) => e.id === entryId)
      if (moved) moved.manualOrder = slots[i] ?? i
    })
  })
  return true
}

/** The token of the active entry in the active scene, if it still exists. */
export function activeToken(scene: Scene): Token | null {
  const { activeEntryId, entries } = scene.initiative
  const entry = entries.find((e) => e.id === activeEntryId)
  if (!entry?.tokenId) return null
  return scene.layers.tokens.find((token) => token.id === entry.tokenId) ?? null
}

/**
 * "Center on active" (SPEC §5.8): the DM camera centers on the active token,
 * keeping the zoom. Refused while players follow the DM camera and cannot see
 * that token (hidden or in the dark): the TV would pan onto it.
 */
export function centerOnActiveToken(): boolean {
  const campaign = getCampaign()
  const token = activeToken(currentScene())
  if (!token) return false
  if (campaign.presentation.cameraMode === 'follow' && useSessionStore.getState().players > 0) {
    const ui = useUiStore.getState()
    const view = projectForPlayers(campaign, ui, useDevicePrefs.getState())
    const seen = !view.blackout && view.scene.tokens.some((t) => t.id === token.id)
    if (!seen && !view.blackout) {
      notify(
        'Players follow your view and cannot see this creature: centering would show where it is.',
      )
      return false
    }
  }
  useUiStore.setState((ui) => ({ dmCamera: { ...ui.dmCamera, x: token.x, y: token.y } }))
  return true
}
