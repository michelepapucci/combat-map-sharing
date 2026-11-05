import type { Id, PlayerViewState } from '../state/types'
import {
  parsePlayerMessage,
  playerLockName,
  post,
  SYNC_CHANNEL,
  type PingMessage,
} from './protocol'

/**
 * The DM side of the player sync. Store-free: the caller supplies `project`
 * (projectForPlayers over the current state) and calls `invalidate()` when
 * anything players might see changed. Views are full snapshots (Decision 27),
 * sent at most every THROTTLE_MS and only when they differ from the last one;
 * nothing is computed while no player window is connected.
 */
export const THROTTLE_MS = 50

export interface DmSyncOptions {
  /** The current view, or null when there is nothing to show (no campaign loaded). */
  project: () => PlayerViewState | null
  /** A player window connected or went away. */
  onPlayers: (count: number, change: 'connected' | 'disconnected') => void
}

export interface DmSync {
  /** Something players might see changed; a view goes out within THROTTLE_MS. */
  invalidate: () => void
  /** Sends a pending throttled view now (the page is going away). */
  flush: () => void
  ping: (ping: { id: Id; x: number; y: number; sceneId: Id }) => void
  playerCount: () => number
  dispose: () => void
}

export function createDmSync({ project, onPlayers }: DmSyncOptions): DmSync {
  const channel = new BroadcastChannel(SYNC_CHANNEL)
  const dm = crypto.randomUUID()
  /** Connected player windows; each entry stops watching its lock. */
  const players = new Map<string, AbortController>()
  let lastJson: string | null = null
  let lastFogJson: string | null = null
  let fogRevision = 0
  let lastSent = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const send = (force: boolean) => {
    timer = null
    if (disposed || players.size === 0) return
    const state = project()
    if (!state) return
    const json = JSON.stringify(state)
    if (!force && json === lastJson) return
    lastJson = json
    const fogJson = state.blackout ? 'blackout' : JSON.stringify(state.scene.fog)
    if (fogJson !== lastFogJson) {
      lastFogJson = fogJson
      fogRevision += 1
    }
    lastSent = performance.now()
    post(channel, { v: 1, type: 'view', dm, state, fogRevision })
  }

  const invalidate = () => {
    if (disposed || players.size === 0 || timer !== null) return
    const wait = THROTTLE_MS - (performance.now() - lastSent)
    if (wait <= 0) send(false)
    else timer = setTimeout(() => send(false), wait)
  }

  const disconnected = (clientId: string) => {
    const watch = players.get(clientId)
    if (!watch) return
    watch.abort()
    players.delete(clientId)
    onPlayers(players.size, 'disconnected')
  }

  /** Learns that a player window closed (or crashed) when its lock becomes free. */
  const watch = (clientId: string, controller: AbortController) => {
    if (!('locks' in navigator)) return
    navigator.locks
      .request(playerLockName(clientId), { signal: controller.signal }, () => {
        disconnected(clientId)
      })
      .catch(() => undefined) // aborted: disposed, or the player said bye first
  }

  channel.addEventListener('message', (event: MessageEvent<unknown>) => {
    const message = parsePlayerMessage(event.data)
    if (!message || disposed) return
    if (message.type === 'bye') {
      disconnected(message.clientId)
      return
    }
    if (!players.has(message.clientId)) {
      const controller = new AbortController()
      players.set(message.clientId, controller)
      watch(message.clientId, controller)
      onPlayers(players.size, 'connected')
    }
    // A (re)connecting window needs the current view now, even if nothing changed.
    if (timer !== null) clearTimeout(timer)
    send(true)
  })

  post(channel, { v: 1, type: 'dm-online', dm })

  return {
    invalidate,
    flush() {
      if (timer === null) return
      clearTimeout(timer)
      send(false)
    },
    ping({ id, x, y, sceneId }) {
      if (disposed) return
      const message: PingMessage = { v: 1, type: 'ping', dm, id, x, y, sceneId }
      post(channel, message)
    },
    playerCount: () => players.size,
    dispose() {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      for (const controller of players.values()) controller.abort()
      players.clear()
      channel.close()
    },
  }
}
