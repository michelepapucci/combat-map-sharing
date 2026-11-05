import { useMemo, useSyncExternalStore } from 'react'
import { parseHash, type Route } from './route'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

const getHash = (): string => window.location.hash

/** The current hash route; re-renders on `hashchange`. */
export function useHashRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash)
  return useMemo(() => parseHash(hash), [hash])
}
