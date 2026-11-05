import { create } from 'zustand'

/**
 * Where the DM's side panels are: docked in the right sidebar (in PANEL_ORDER)
 * or floating over the map at a position the DM chose, and whether each one is
 * collapsed. A device preference (localStorage `vtt:panels`), never part of the
 * campaign. Loaded once by the DM window (no import-time side effects).
 */

export const PANEL_IDS = [
  'player-view',
  'initiative',
  'library',
  'layers',
  'properties',
  'scene',
] as const
export type PanelId = (typeof PANEL_IDS)[number]

export interface PanelPlacement {
  floating: boolean
  collapsed: boolean
  /** Floating window: top-left corner in viewport px. */
  x: number
  y: number
  width: number
  /** Floating height in px, or null to fit the content (up to the window's bottom). */
  height: number | null
  /** Stacking order among floating panels: higher is on top. */
  z: number
}

export const MIN_PANEL_WIDTH = 240
export const MAX_PANEL_WIDTH = 720
export const MIN_PANEL_HEIGHT = 120
/** Part of a floating panel that always stays on screen, so it can be grabbed again. */
const KEEP_VISIBLE = 72
const HEADER_HEIGHT = 40
const STORAGE_KEY = 'vtt:panels'

function defaultPlacement(): PanelPlacement {
  return { floating: false, collapsed: false, x: 80, y: 80, width: 340, height: null, z: 0 }
}

function defaults(): Record<PanelId, PanelPlacement> {
  return Object.fromEntries(PANEL_IDS.map((id) => [id, defaultPlacement()])) as Record<
    PanelId,
    PanelPlacement
  >
}

interface PanelLayoutState {
  panels: Record<PanelId, PanelPlacement>
}

export const usePanelLayout = create<PanelLayoutState>()(() => ({ panels: defaults() }))

/** Whether the right sidebar has any docked panel (otherwise the map takes its room). */
export function useHasDockedPanels(): boolean {
  return usePanelLayout((s) => PANEL_IDS.some((id) => !s.panels[id].floating))
}

function viewport(): { width: number; height: number } {
  return typeof window === 'undefined'
    ? { width: 1280, height: 800 }
    : { width: window.innerWidth, height: window.innerHeight }
}

/** Keeps a floating panel's header reachable inside the window, and its size sane. */
export function clampPlacement(placement: PanelPlacement, view = viewport()): PanelPlacement {
  const width = Math.min(
    Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, placement.width)),
    Math.max(MIN_PANEL_WIDTH, view.width - 16),
  )
  const height =
    placement.height === null
      ? null
      : Math.min(
          Math.max(MIN_PANEL_HEIGHT, placement.height),
          Math.max(MIN_PANEL_HEIGHT, view.height - 16),
        )
  const x = Math.min(Math.max(placement.x, KEEP_VISIBLE - width), view.width - KEEP_VISIBLE)
  const y = Math.min(Math.max(placement.y, 0), view.height - HEADER_HEIGHT)
  return {
    ...placement,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: height === null ? null : Math.round(height),
  }
}

function update(id: PanelId, patch: Partial<PanelPlacement>): void {
  usePanelLayout.setState((state) => ({
    panels: { ...state.panels, [id]: { ...state.panels[id], ...patch } },
  }))
  scheduleSave()
}

/**
 * Puts `id` on top of the floating panels, renumbering them 1..n so the
 * stacking order stays small (it is a z-index under menus and dialogs).
 */
function raise(
  panels: Record<PanelId, PanelPlacement>,
  id: PanelId,
): Record<PanelId, PanelPlacement> {
  const order = PANEL_IDS.filter((other) => other !== id && panels[other].floating).toSorted(
    (a, b) => panels[a].z - panels[b].z,
  )
  order.push(id)
  const next = { ...panels }
  order.forEach((other, i) => {
    next[other] = { ...next[other], z: i + 1 }
  })
  return next
}

export function setCollapsed(id: PanelId, collapsed: boolean): void {
  update(id, { collapsed })
}

/** Floats a panel, starting where the DM sees it (`at`, viewport px). */
export function popOut(id: PanelId, at: { x: number; y: number; width: number }): void {
  usePanelLayout.setState((state) => {
    const panels = {
      ...state.panels,
      [id]: clampPlacement({ ...state.panels[id], ...at, floating: true }),
    }
    return { panels: raise(panels, id) }
  })
  scheduleSave()
}

export function dock(id: PanelId): void {
  update(id, { floating: false })
}

export function movePanel(id: PanelId, x: number, y: number): void {
  update(id, clampPlacement({ ...usePanelLayout.getState().panels[id], x, y }))
}

export function resizePanel(id: PanelId, width: number, height: number | null): void {
  update(id, clampPlacement({ ...usePanelLayout.getState().panels[id], width, height }))
}

export function bringToFront(id: PanelId): void {
  const { panels } = usePanelLayout.getState()
  if (!panels[id].floating) return
  const top = Math.max(
    ...PANEL_IDS.filter((other) => panels[other].floating).map((other) => panels[other].z),
  )
  if (panels[id].z >= top) return
  usePanelLayout.setState({ panels: raise(panels, id) })
  scheduleSave()
}

/** Shows a panel the DM asked for (for example "Edit token"): expanded and on top. */
export function revealPanel(id: PanelId): void {
  update(id, { collapsed: false })
  bringToFront(id)
}

/** Keeps every floating panel reachable after the window got smaller. */
export function clampAllToViewport(): void {
  const { panels } = usePanelLayout.getState()
  const next = { ...panels }
  let changed = false
  for (const id of PANEL_IDS) {
    if (!panels[id].floating) continue
    const clamped = clampPlacement(panels[id])
    if (JSON.stringify(clamped) !== JSON.stringify(panels[id])) {
      next[id] = clamped
      changed = true
    }
  }
  if (changed) {
    usePanelLayout.setState({ panels: next })
    scheduleSave()
  }
}

// --- Persistence ---------------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSave(): void {
  if (saveTimer !== null) return
  // Drags update the layout every frame: write at most a few times a second.
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(usePanelLayout.getState().panels))
    } catch {
      // A preference only: blocked storage just forgets the layout.
    }
  }, 250)
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Reads a stored layout, keeping only well-formed fields (anything else falls back to defaults). */
export function parsePanelLayout(raw: unknown): Record<PanelId, PanelPlacement> {
  const result = defaults()
  if (typeof raw !== 'object' || raw === null) return result
  for (const id of PANEL_IDS) {
    const stored: unknown = Object.hasOwn(raw, id) ? (raw as Record<string, unknown>)[id] : null
    if (typeof stored !== 'object' || stored === null) continue
    const s = stored as Record<string, unknown>
    const base = result[id]
    const placement: PanelPlacement = {
      floating: s.floating === true,
      collapsed: s.collapsed === true,
      x: finiteOr(s.x, base.x),
      y: finiteOr(s.y, base.y),
      width: finiteOr(s.width, base.width),
      height: s.height === null ? null : finiteOr(s.height, Number.NaN),
      z: finiteOr(s.z, 0),
    }
    if (placement.height !== null && !Number.isFinite(placement.height)) placement.height = null
    result[id] = placement.floating ? clampPlacement(placement) : placement
  }
  return result
}

/** Loads this device's layout (once, when the DM window starts). */
export function loadPanelLayout(): void {
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    if (text) usePanelLayout.setState({ panels: parsePanelLayout(JSON.parse(text)) })
  } catch {
    // Unreadable or blocked: keep the defaults.
  }
}
