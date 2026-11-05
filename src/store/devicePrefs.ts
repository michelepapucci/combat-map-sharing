import { create } from 'zustand'

/**
 * Preferences of this device, never part of the campaign (CLAUDE.md,
 * "Conventions"): they depend on the physical display and must not travel with
 * gists or backups. Read from localStorage when the DM session starts.
 */
export interface DevicePrefsState {
  /** Player window scale lock "1 square = N px" (SPEC §5.9), or null for fit-to-view. */
  lockedCellPx: number | null
}

const LOCKED_CELL_PX_KEY = 'vtt:lockedCellPx'

export const useDevicePrefs = create<DevicePrefsState>()(() => ({ lockedCellPx: null }))

function readNumber(key: string): number | null {
  try {
    const value = Number(localStorage.getItem(key))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

export function loadDevicePrefs(): void {
  useDevicePrefs.setState({ lockedCellPx: readNumber(LOCKED_CELL_PX_KEY) })
}

export function setLockedCellPx(value: number | null): void {
  const clean = value !== null && Number.isFinite(value) && value > 0 ? value : null
  useDevicePrefs.setState({ lockedCellPx: clean })
  try {
    if (clean === null) localStorage.removeItem(LOCKED_CELL_PX_KEY)
    else localStorage.setItem(LOCKED_CELL_PX_KEY, String(clean))
  } catch {
    // Storage blocked: the preference lasts for this session only.
  }
}
