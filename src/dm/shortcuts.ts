import { useEffect } from 'react'
import {
  copyItems,
  currentScene,
  deleteItems,
  duplicateItems,
  nudgeItems,
  pasteItems,
  redoAction,
  toggleHidden,
  toggleLocked,
  undoAction,
} from '../store/actions'
import { useCampaignStore } from '../store/campaign'
import { isModalOpen, notify, setSelection, setTool, useUiStore } from '../store/ui'
import { getPointerWorld } from './canvas/pointer'
import { nextTurn, previousTurn } from '../store/initiativeActions'
import {
  deleteTemplates,
  nudgeTemplates,
  pinTemplate,
  selectedTemplateIds,
  toggleTemplatesVisible,
} from '../store/templateActions'
import { closeFogPolygon, removeLastFogCorner } from './fogTool'
import { flushSave } from './session'
import { saveToGist } from './gist'
import { useGistStore } from '../store/gist'

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const MOD = IS_MAC ? '⌘' : 'Ctrl'

/** The cheat sheet (?), grouped. Keep it in sync with handleShortcut below. */
export const SHORTCUT_GROUPS: readonly {
  title: string
  rows: readonly { keys: string[]; action: string }[]
}[] = [
  {
    title: 'Editing',
    rows: [
      { keys: [`${MOD}+S`], action: 'Save now (it also saves on its own)' },
      { keys: [`${MOD}+Z`], action: 'Undo' },
      { keys: [`${MOD}+Shift+Z`, `${MOD}+Y`], action: 'Redo' },
      { keys: [`${MOD}+C`], action: 'Copy' },
      { keys: [`${MOD}+V`], action: 'Paste (under the pointer)' },
      { keys: [`${MOD}+D`], action: 'Duplicate' },
      { keys: ['Del', 'Backspace'], action: 'Delete' },
      { keys: ['Arrows'], action: 'Nudge by 1 cell' },
      { keys: ['Shift+Arrows'], action: 'Nudge by 1 px' },
      { keys: ['H'], action: 'Hide / show for players' },
      { keys: ['L'], action: 'Lock / unlock' },
      { keys: ['Esc'], action: 'Cancel, then deselect' },
    ],
  },
  {
    title: 'Tools',
    rows: [
      { keys: ['V'], action: 'Select' },
      {
        keys: ['P'],
        action: 'Ping: click to show players a point (Alt+click works with any tool)',
      },
      {
        keys: ['F'],
        action: 'Fog: drag a rectangle or brush, or click polygon corners (Enter closes)',
      },
      {
        keys: ['M'],
        action: 'Measure: drag from a square; Shift on release adds a waypoint; Alt is free',
      },
      {
        keys: ['A'],
        action: 'Area of effect: drag from the origin; Enter pins it, Esc discards it',
      },
      { keys: ['?'], action: 'This cheat sheet' },
    ],
  },
  {
    title: 'Combat',
    rows: [
      { keys: ['N'], action: 'Next turn (starts combat; a new round after the last)' },
      { keys: ['Shift+N'], action: 'Previous turn' },
    ],
  },
  {
    title: 'Mouse',
    rows: [
      { keys: ['Wheel'], action: 'Zoom toward the pointer' },
      {
        keys: ['Middle drag', 'Space+drag', 'Right drag'],
        action: 'Pan (right drag on empty space)',
      },
      { keys: ['Shift+click'], action: 'Add to / remove from the selection' },
      { keys: ['Drag on empty space'], action: 'Select with a box' },
      { keys: ['Alt'], action: 'Hold while dragging or resizing to skip snapping' },
      {
        keys: ['Shift'],
        action: 'Hold while resizing to keep the ratio, or rotating for 15° steps',
      },
      { keys: ['Right-click'], action: 'Item menu' },
    ],
  },
]

/** Keys typed into fields must reach the field, not the canvas. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLInputElement) {
    // Range inputs keep their arrow keys; checkboxes and color pickers don't use them.
    return !['checkbox', 'radio', 'button', 'color'].includes(target.type)
  }
  return false
}

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
}

export function handleShortcut(event: KeyboardEvent): boolean {
  const ui = useUiStore.getState()
  // No shortcuts while a drag or a fog stroke is in flight: the drop commits
  // what was computed from its start (Esc is handled by the canvas gesture).
  const stroking = ui.fogDraft !== null && ui.fogDraft.type !== 'polygon'
  if (!useCampaignStore.getState().campaign || isModalOpen(ui) || ui.liveDrag || stroking) {
    return false
  }
  const selection = ui.selection
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  // "Preview as players" only looks: no editing shortcuts until it ends (Esc).
  // Ctrl+S still saves rather than opening the browser's "Save page".
  if (ui.previewAsPlayers && key !== 'Escape' && key !== '?' && !(mod && key === 's')) return false

  if (mod && !event.altKey) {
    switch (key) {
      case 'z':
        if (event.shiftKey) redoAction()
        else undoAction()
        return true
      case 'y':
        redoAction()
        return true
      case 'c':
        if (selection.length === 0 || window.getSelection()?.toString()) return false
        copyItems(selection)
        return true
      case 'v':
        pasteItems(getPointerWorld())
        return true
      case 'd':
        if (selection.length > 0) duplicateItems(selection)
        return true
      case 's': {
        // "Save to Gist" when this campaign syncs with one (SPEC §7); otherwise
        // saves in this browser now instead of opening the browser's "Save page".
        const gist = useGistStore.getState()
        if (gist.token && gist.link) {
          void saveToGist()
          return true
        }
        flushSave().then(
          () => notify('Saved in this browser.'),
          () => undefined, // the save indicator shows the error
        )
        return true
      }
      default:
        return false
    }
  }
  // The fog polygon being drawn takes Enter (close) and Backspace (remove the
  // last corner). With the Fog tool, Backspace/Delete never delete the selection:
  // one press too many while removing corners must not delete a token.
  if (ui.tool === 'fog' && !mod) {
    const polygon = ui.fogDraft?.type === 'polygon'
    if (key === 'Enter' && polygon) return closeFogPolygon() || true
    if (key === 'Backspace' || key === 'Delete') return removeLastFogCorner() || true
  }
  if (mod || event.altKey) return false

  const arrow = ARROWS[event.key]
  if (arrow) {
    if (selection.length === 0) return false
    const step = event.shiftKey ? 1 : currentScene().grid.size
    // Selected templates move with the arrows too (they are not items).
    const templates = selectedTemplateIds(currentScene(), selection)
    const items = selection.filter((id) => !templates.includes(id))
    if (items.length > 0) nudgeItems(items, arrow[0] * step, arrow[1] * step)
    if (templates.length > 0) nudgeTemplates(templates, arrow[0] * step, arrow[1] * step)
    return true
  }
  switch (key) {
    case 'Delete':
    case 'Backspace': {
      if (selection.length === 0) return false
      // Pinned templates are selectable too; items and templates are deleted apart.
      const templates = selectedTemplateIds(currentScene(), selection)
      const items = selection.filter((id) => !templates.includes(id))
      if (items.length > 0) deleteItems(items)
      if (templates.length > 0) deleteTemplates(templates)
      return true
    }
    case 'h': {
      const templates = selectedTemplateIds(currentScene(), selection)
      const items = selection.filter((id) => !templates.includes(id))
      if (items.length > 0) toggleHidden(items)
      if (templates.length > 0) toggleTemplatesVisible(templates)
      return selection.length > 0
    }
    case 'Enter':
      // Pins the template being placed (Area of effect tool), unless Enter is
      // pressing a focused button or similar control.
      if (ui.tool !== 'aoe' || !ui.tempTemplate) return false
      if (
        event.target instanceof Element &&
        event.target.closest('button, a, [role="button"], [role="radio"], [role="tab"]')
      ) {
        return false
      }
      pinTemplate()
      return true
    case 'm':
      setTool('measure')
      return true
    case 'a':
      setTool('aoe')
      return true
    case 'l':
      toggleLocked(selection)
      return selection.length > 0
    case 'v':
      setTool('select')
      return true
    case 'p':
      setTool('ping')
      return true
    case 'f':
      setTool('fog')
      return true
    case 'n':
      // Holding the key must not race through several turns.
      if (event.repeat) return true
      if (event.shiftKey) previousTurn()
      else nextTurn()
      return true
    case '?':
      useUiStore.setState({ shortcutsOpen: true, contextMenu: null })
      return true
    case 'Escape':
      if (ui.previewAsPlayers) useUiStore.setState({ previewAsPlayers: false })
      else if (ui.contextMenu) useUiStore.setState({ contextMenu: null })
      else if (ui.fogDraft) useUiStore.setState({ fogDraft: null })
      else if (ui.measurement) useUiStore.setState({ measurement: null, measuring: null })
      else if (ui.tempTemplate) useUiStore.setState({ tempTemplate: null })
      else if (ui.tool !== 'select') setTool('select')
      else if (selection.length > 0) setSelection([])
      else return false
      return true
    default:
      return false
  }
}

/** Installs the DM window's keyboard shortcuts (SPEC §5.3). */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isTypingTarget(event.target)) return
      // Dialogs and menus handle their own keys (Delete in the scene menu must not delete items).
      if (event.target instanceof Element && event.target.closest('dialog, [role="menu"]')) return
      if (handleShortcut(event)) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
