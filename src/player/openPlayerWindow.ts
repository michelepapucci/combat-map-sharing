import { ROUTE_HASH } from '../app/route'

/** Window name, so a second click re-focuses the existing player window instead of opening another. */
export const PLAYER_WINDOW_NAME = 'vtt-player'

/** Opens (or re-focuses) the presentation window on `#/player`, same origin as the DM window. */
export function openPlayerWindow(): Window | null {
  const playerWindow = window.open(ROUTE_HASH.player, PLAYER_WINDOW_NAME)
  playerWindow?.focus()
  return playerWindow
}
