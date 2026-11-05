import type { PlayerViewState } from '../state/types'
import {
  DM_LOCK,
  parseDmMessage,
  playerLockName,
  post,
  SYNC_CHANNEL,
  type PingMessage,
} from './protocol'

/**
 * The player window's side of the sync. It only listens: it announces itself
 * (`hello`, then `bye` on page hide) and renders what the DM sends. It never
 * writes state and never touches `window.opener`.
 *
 * Presence: the window holds its own lock for its lifetime (so the DM learns
 * when it closes) and, once a DM has shown up, queues a request for the DM's
 * lock: being granted it means the DM window is gone. It releases that lock at
 * once, so a new DM tab can take it.
 */
export interface PlayerClientHandlers {
  onView: (state: PlayerViewState, fogRevision: number) => void
  onPing: (ping: PingMessage) => void
  /** The DM window went away (after having been there). */
  onDmGone: () => void
}

const noop = () => undefined

export function connectPlayer(handlers: PlayerClientHandlers): () => void {
  const clientId = crypto.randomUUID()
  const channel = new BroadcastChannel(SYNC_CHANNEL)
  const stop = new AbortController()
  let watchingDm = false
  let closed = false
  /** The DM tab followed: the last one that announced itself (or the first one heard). */
  let currentDm: string | null = null

  const hello = () => post(channel, { v: 1, type: 'hello', clientId })

  const watchDm = () => {
    if (watchingDm || closed || !('locks' in navigator)) return
    watchingDm = true
    navigator.locks
      .request(DM_LOCK, { signal: stop.signal }, () => {
        // Granted: the DM tab released its lock (closed, reloaded or handed over).
        watchingDm = false
        if (!closed) handlers.onDmGone()
        // Returning releases the lock immediately, so a new DM tab can take it.
      })
      .catch(() => {
        watchingDm = false
      })
  }

  channel.addEventListener('message', (event: MessageEvent<unknown>) => {
    const message = parseDmMessage(event.data)
    if (!message || closed) return
    if (message.type === 'dm-online') {
      currentDm = message.dm
      hello()
      return
    }
    currentDm ??= message.dm
    if (message.dm !== currentDm) return // a stale DM tab
    if (message.type === 'view') {
      handlers.onView(message.state, message.fogRevision)
      watchDm()
    } else {
      handlers.onPing(message)
    }
  })

  const bye = () => post(channel, { v: 1, type: 'bye', clientId })
  window.addEventListener('pagehide', bye)

  // Hold our own lock before saying hello, so the DM's watch never sees it free too early.
  if ('locks' in navigator) {
    let held: () => void = noop
    navigator.locks
      .request(playerLockName(clientId), { signal: stop.signal }, () => {
        if (closed) return undefined // granted after closing: release at once
        hello()
        return new Promise<void>((release) => {
          held = release
        })
      })
      .catch(() => undefined)
    stop.signal.addEventListener('abort', () => held())
  } else {
    hello()
  }

  return () => {
    if (closed) return
    closed = true
    bye()
    window.removeEventListener('pagehide', bye)
    stop.abort()
    channel.close()
  }
}
