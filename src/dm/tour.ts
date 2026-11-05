import { useUiStore } from '../store/ui'

/**
 * The getting-started tour (SPEC §8 "a 4-step hint overlay"): shown once per
 * device, re-opened from the keyboard cheat sheet. A device preference
 * (localStorage `vtt:tour`), never campaign data.
 */
const TOUR_KEY = 'vtt:tour'

export function tourDone(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === 'done'
  } catch {
    return true // storage blocked: do not nag on every visit
  }
}

export function markTourDone(): void {
  try {
    localStorage.setItem(TOUR_KEY, 'done')
  } catch {
    // A preference only.
  }
}

export function openTour(): void {
  useUiStore.setState({ tourOpen: true, shortcutsOpen: false })
}

export function closeTour(): void {
  markTourDone()
  useUiStore.setState({ tourOpen: false })
}

/** Opens the tour the first time this device runs the DM window. */
export function startTourIfNew(): void {
  if (!tourDone()) useUiStore.setState({ tourOpen: true })
}
