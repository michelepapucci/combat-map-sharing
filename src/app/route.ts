/**
 * Hash routes. The app is a static site on GitHub Pages, so routing lives in the
 * URL fragment: `#/dm` (editor) and `#/player` (presentation window).
 * Pure module: no React, no DOM, so it is unit-testable in Node.
 */
export type Route =
  | { readonly name: 'dm' }
  | { readonly name: 'player' }
  /** Empty hash: the app opens the DM view and normalises the URL to `#/dm`. */
  | { readonly name: 'root' }
  | { readonly name: 'not-found'; readonly path: string }

export const ROUTE_HASH = {
  dm: '#/dm',
  player: '#/player',
} as const

/** Parses `location.hash` (e.g. `#/player`, `#/dm/`, `#/dm?x=1`, ``) into a route. */
export function parseHash(hash: string): Route {
  const withoutHash = hash.startsWith('#') ? hash.slice(1) : hash
  const path = (withoutHash.split('?')[0] ?? '').replace(/\/+$/, '')
  switch (path) {
    case '':
      return { name: 'root' }
    case '/dm':
      return { name: 'dm' }
    case '/player':
      return { name: 'player' }
    default:
      return { name: 'not-found', path }
  }
}
