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
import { setSelection, setTool, useUiStore } from '../store/ui'
import { getPointerWorld } from './canvas/pointer'

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
        keys: ['M', 'A', 'F', 'P'],
        action: 'Measure, area of effect, fog, ping (later milestones)',
      },
      { keys: ['?'], action: 'This cheat sheet' },
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
  // No shortcuts while a drag is in flight: the drop commits positions computed at its start.
  if (!useCampaignStore.getState().campaign || ui.shortcutsOpen || ui.liveDrag) return false
  const selection = ui.selection
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key

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
      default:
        return false
    }
  }
  if (mod || event.altKey) return false

  const arrow = ARROWS[event.key]
  if (arrow) {
    if (selection.length === 0) return false
    const step = event.shiftKey ? 1 : currentScene().grid.size
    nudgeItems(selection, arrow[0] * step, arrow[1] * step)
    return true
  }
  switch (key) {
    case 'Delete':
    case 'Backspace':
      if (selection.length === 0) return false
      deleteItems(selection)
      return true
    case 'h':
      toggleHidden(selection)
      return selection.length > 0
    case 'l':
      toggleLocked(selection)
      return selection.length > 0
    case 'v':
      setTool('select')
      return true
    case '?':
      useUiStore.setState({ shortcutsOpen: true, contextMenu: null })
      return true
    case 'Escape':
      if (ui.contextMenu) useUiStore.setState({ contextMenu: null })
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
      if (handleShortcut(event)) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
