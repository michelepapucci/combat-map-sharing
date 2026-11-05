import { create } from 'zustand'
import type { Camera, Id, Item, LayerName, Ping, Token, Tool, UiState } from '../state/types'

/** A copied item with the layer it came from. Plain deep copies, independent of the campaign. */
export interface ClipboardEntry {
  layer: LayerName
  item: Item | Token
}

export interface Notice {
  id: number
  /** One or more sentences; each paragraph on its own line. */
  lines: string[]
  /** Stays until dismissed (warnings and errors); otherwise it fades after a few seconds. */
  sticky: boolean
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
  /** An image import in progress: shown as a progress notice, and Upload buttons are disabled. */
  importProgress: { done: number; total: number } | null
  /** Incremented to ask the properties panel to take focus ("Edit token"). */
  propertiesFocusRequest: number
  /** DM camera per scene, so switching back to a scene returns to the same view. */
  sceneCameras: Record<Id, Camera>
  /** Fit the view to the scene's content as soon as the canvas knows its size. */
  fitPending: boolean
  /** Open modal dialog (the cheat sheet has its own flag). */
  dialog: 'campaigns' | 'settings' | null
  /** Library asset shown in the asset dialog. */
  editingAssetId: Id | null
  /** Pings drawn in the DM window (they are also sent to players). */
  pings: Ping[]
}

/** Modal UI that takes the keyboard: canvas shortcuts are off while one is open. */
export function isModalOpen(ui: DmUiState): boolean {
  return ui.shortcutsOpen || ui.dialog !== null || ui.editingAssetId !== null
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
    importProgress: null,
    propertiesFocusRequest: 0,
    sceneCameras: {},
    fitPending: true,
    dialog: null,
    editingAssetId: null,
    pings: [],
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

/** Shows a short status message at the bottom of the canvas; it fades after a few seconds. */
export function notify(text: string): void {
  noticeId += 1
  useUiStore.setState({ notice: { id: noticeId, lines: [text], sticky: false } })
}

/** Shows a message that stays until the DM dismisses it (warnings, errors, several lines). */
export function notifySticky(lines: string[]): void {
  noticeId += 1
  useUiStore.setState({ notice: { id: noticeId, lines, sticky: true } })
}

/**
 * UI follow-up when the active scene changes (switch, undo, delete): remember
 * the old scene's view, restore the new one's (or fit it), and drop anything
 * that referred to the old scene's items.
 */
export function sceneSwitched(from: Id, to: Id): void {
  const ui = useUiStore.getState()
  const saved = ui.sceneCameras[to]
  useUiStore.setState({
    sceneCameras: { ...ui.sceneCameras, [from]: ui.dmCamera },
    dmCamera: saved ?? ui.dmCamera,
    fitPending: saved === undefined,
    selection: [],
    hoveredId: null,
    dragPrimaryId: null,
    contextMenu: null,
    liveDrag: null,
    pasteCount: 0,
    measurement: null,
    tempTemplate: null,
    tool: ui.tool === 'calibrate' ? 'select' : ui.tool,
  })
}

/** Fresh UI for a newly loaded campaign; per-device choices and the canvas size survive. */
export function resetUiForCampaign(): void {
  const { tokenColor, calibrationCells, dmViewport, notice, importProgress } = useUiStore.getState()
  useUiStore.setState({
    ...initialUiState(),
    tokenColor,
    calibrationCells,
    dmViewport,
    notice,
    importProgress,
  })
}
