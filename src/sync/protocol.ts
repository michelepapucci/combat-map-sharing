import type { Id, PlayerViewState } from '../state/types'

/**
 * The DM ↔ player protocol on BroadcastChannel('vtt-sync') (CLAUDE.md, "Sync").
 * Every message is tagged `{ v: 1, type }`. Only `view` carries campaign-derived
 * data, and only a PlayerViewState built by projectForPlayers; a ping carries a
 * point. Same-origin pages could post here too, so receivers parse defensively.
 *
 * Presence uses Web Locks, not timers (background tabs throttle timers): the DM
 * holds DM_LOCK, each player window holds playerLockName(clientId); each side
 * queues a request for the other's lock and learns it is gone when granted.
 */
export const SYNC_CHANNEL = 'vtt-sync'
export const PROTOCOL_VERSION = 1
/** Held by the DM tab that edits (src/dm/session.ts). */
export const DM_LOCK = 'vtt:dm'

export function playerLockName(clientId: string): string {
  return `vtt:player:${clientId}`
}

export interface PingMessage {
  v: 1
  type: 'ping'
  dm: string
  id: Id
  x: number
  y: number
  /** Players ignore pings for another scene. */
  sceneId: Id
}

/**
 * Every DM message carries `dm`, a random id per DM tab session: players follow
 * the tab that announced itself last, so a stale tab (taken over while frozen)
 * cannot overwrite the current view.
 */
export type DmMessage =
  /** A DM tab took the lock: players announce themselves again. */
  | { v: 1; type: 'dm-online'; dm: string }
  | {
      v: 1
      type: 'view'
      dm: string
      state: PlayerViewState
      /** Changes only when the fog part changed, so players re-rasterize fog only then. */
      fogRevision: number
    }
  | PingMessage

export type PlayerMessage =
  { v: 1; type: 'hello'; clientId: string } | { v: 1; type: 'bye'; clientId: string }

function record(data: unknown): Record<string, unknown> | null {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** A DM message, or null for anything else (other versions, other senders, garbage). */
export function parseDmMessage(data: unknown): DmMessage | null {
  const m = record(data)
  if (!m || m['v'] !== PROTOCOL_VERSION) return null
  const dm = m['dm']
  if (typeof dm !== 'string' || dm === '' || dm.length > 64) return null
  switch (m['type']) {
    case 'dm-online':
      return { v: 1, type: 'dm-online', dm }
    case 'view': {
      const state = record(m['state'])
      const fogRevision = m['fogRevision']
      if (!state || typeof state['blackout'] !== 'boolean' || !isFiniteNumber(fogRevision)) {
        return null
      }
      if (state['blackout'] === false && !record(state['scene'])) return null
      return { v: 1, type: 'view', dm, state: state as unknown as PlayerViewState, fogRevision }
    }
    case 'ping': {
      const { id, x, y, sceneId } = m
      if (typeof id !== 'string' || typeof sceneId !== 'string') return null
      if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null
      return { v: 1, type: 'ping', dm, id, x, y, sceneId }
    }
    default:
      return null
  }
}

/** A player message, or null. */
export function parsePlayerMessage(data: unknown): PlayerMessage | null {
  const m = record(data)
  if (!m || m['v'] !== PROTOCOL_VERSION) return null
  const clientId = m['clientId']
  if (typeof clientId !== 'string' || clientId === '' || clientId.length > 64) return null
  if (m['type'] === 'hello') return { v: 1, type: 'hello', clientId }
  if (m['type'] === 'bye') return { v: 1, type: 'bye', clientId }
  return null
}

/** Posts on a BroadcastChannel (which has no target origin). */
export function post(channel: BroadcastChannel, message: DmMessage | PlayerMessage): void {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel has no target origin
  channel.postMessage(message)
}
