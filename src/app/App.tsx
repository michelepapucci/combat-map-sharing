import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { NotFound } from './NotFound'
import { ROUTE_HASH } from './route'
import { useHashRoute } from './useHashRoute'

// Each window loads only its own code: the player window must never evaluate DM
// modules (stores, persistence, gist client). Keep these imports dynamic; an e2e
// test and src/architecture.test.ts check it.
const DmApp = lazy(() => import('../dm/DmApp').then((m) => ({ default: m.DmApp })))
const PlayerApp = lazy(() => import('../player/PlayerApp').then((m) => ({ default: m.PlayerApp })))

export function App() {
  const route = useHashRoute()
  const isPlayer = route.name === 'player'

  useEffect(() => {
    // An empty hash opens the DM view; normalise the URL without adding a history entry.
    if (route.name === 'root') history.replaceState(null, '', ROUTE_HASH.dm)
  }, [route.name])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.view = isPlayer ? 'player' : 'dm'
    // The player window is always dark; the DM window applies its theme in useTheme.
    if (isPlayer) root.dataset.theme = 'dark'
    // The player window's title is generic on purpose: it is visible on the shared screen.
    document.title = isPlayer ? 'Player view' : 'Combat Map (DM)'
  }, [isPlayer])

  let content: ReactNode
  switch (route.name) {
    case 'root':
    case 'dm':
      content = <DmApp />
      break
    case 'player':
      content = <PlayerApp />
      break
    case 'not-found':
      content = <NotFound path={route.path} />
      break
  }
  return <Suspense fallback={null}>{content}</Suspense>
}
