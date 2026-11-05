import { create } from 'zustand'
import type { Id, Item, LayerName, Token, Tool, UiState } from '../state/types'

/** A copied item with the layer it came from. Plain deep copies, independent of the campaign. */
export interface ClipboardEntry {
  layer: LayerName
  item: Item | Token
}

export interface Notice {
  id: number
  text: string
}

/**
 * Transient DM window state (never persisted, never undoable): the shared
 * UiState fields plus DM-only UI bits.
 */
export interface DmUiState extends UiState {
  hoveredId: Id | null
  /** The item under the pointer when the current drag started (gets the distance label). */
  dragPrimaryId: Id | null
  /** Open context menu position in client px. */
  contextMenu: { x: number; y: number } | null
  clipboard: ClipboardEntry[] | null
  /** Consecutive pastes of the same clipboard, to offset each one. */
  pasteCount: number
  shortcutsOpen: boolean
  /** Calibration tool: the box drawn by the DM spans this many cells per side. */
  calibrationCells: number
  /** Ring color for new tokens; null = the default color of the token's kind. */
  tokenColor: string | null
  notice: Notice | null
  /** Incremented to ask the properties panel to take focus ("Edit token"). */
  propertiesFocusRequest: number
}

export function initialUiState(): DmUiState {
  return {
    tool: 'select',
    selection: [],
    dmCamera: { x: 0, y: 0, zoom: 1 },
    dmViewport: { width: 0, height: 0 },
    measurement: null,
    tempTemplate: null,
    previewAsPlayers: false,
    liveDrag: null,
    hoveredId: null,
    dragPrimaryId: null,
    contextMenu: null,
    clipboard: null,
    pasteCount: 0,
    shortcutsOpen: false,
    calibrationCells: 1,
    tokenColor: null,
    notice: null,
    propertiesFocusRequest: 0,
  }
}

export const useUiStore = create<DmUiState>()(() => initialUiState())

export function setTool(tool: Tool): void {
  useUiStore.setState({ tool, contextMenu: null })
}

export function setSelection(selection: Id[]): void {
  const current = useUiStore.getState().selection
  const same = current.length === selection.length && current.every((id, i) => id === selection[i])
  if (!same) useUiStore.setState({ selection })
}

let noticeId = 0

/** Shows a short status message at the bottom of the canvas. */
export function notify(text: string): void {
  noticeId += 1
  useUiStore.setState({ notice: { id: noticeId, text } })
}
