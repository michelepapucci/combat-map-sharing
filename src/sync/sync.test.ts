import { afterEach, describe, expect, it } from 'vitest'
import type { PlayerViewState } from '../state/types'
import { createDmSync, type DmSync } from './dmSync'
import {
  parseDmMessage,
  parsePlayerMessage,
  playerLockName,
  post,
  SYNC_CHANNEL,
  type DmMessage,
} from './protocol'

describe('protocol parsing', () => {
  it('accepts well-formed DM messages', () => {
    expect(parseDmMessage({ v: 1, type: 'dm-online', dm: 'd' })).toStrictEqual({
      v: 1,
      type: 'dm-online',
      dm: 'd',
    })
    const view = {
      v: 1,
      type: 'view',
      dm: 'd',
      state: { blackout: true, splashAssetId: null },
      fogRevision: 3,
    }
    expect(parseDmMessage(view)).toStrictEqual(view)
    expect(
      parseDmMessage({ v: 1, type: 'ping', dm: 'd', id: 'p', x: 1, y: 2, sceneId: 's', extra: 1 }),
    ).toStrictEqual({ v: 1, type: 'ping', dm: 'd', id: 'p', x: 1, y: 2, sceneId: 's' })
  })

  it.each([
    null,
    'view',
    { v: 2, type: 'dm-online', dm: 'd' },
    { v: 1, type: 'dm-online' },
    { v: 1, type: 'dm-online', dm: '' },
    { v: 1, type: 'nope' },
    { v: 1, type: 'view', dm: 'd', state: { blackout: false }, fogRevision: 1 },
    { v: 1, type: 'view', dm: 'd', state: { blackout: 'no' }, fogRevision: 1 },
    { v: 1, type: 'view', dm: 'd', state: { blackout: true }, fogRevision: Number.NaN },
    { v: 1, type: 'view', state: { blackout: true }, fogRevision: 1 },
    { v: 1, type: 'ping', dm: 'd', id: 'p', x: Infinity, y: 2, sceneId: 's' },
    { v: 1, type: 'ping', dm: 'd', id: 3, x: 1, y: 2, sceneId: 's' },
  ])('rejects %j', (data) => {
    expect(parseDmMessage(data)).toBeNull()
  })

  it('parses player messages', () => {
    expect(parsePlayerMessage({ v: 1, type: 'hello', clientId: 'abc' })).toStrictEqual({
      v: 1,
      type: 'hello',
      clientId: 'abc',
    })
    expect(parsePlayerMessage({ v: 1, type: 'bye', clientId: 'abc' })?.type).toBe('bye')
    expect(parsePlayerMessage({ v: 1, type: 'hello', clientId: '' })).toBeNull()
    expect(parsePlayerMessage({ v: 1, type: 'hello', clientId: 'x'.repeat(65) })).toBeNull()
    expect(parsePlayerMessage({ v: 1, type: 'view' })).toBeNull()
  })
})

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function blackoutView(splashAssetId: string | null): PlayerViewState {
  return { blackout: true, splashAssetId }
}

describe('DM sync', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup()
  })

  /** A fake player window: its own channel and lock, recording what the DM sends. */
  function player() {
    const channel = new BroadcastChannel(SYNC_CHANNEL)
    const received: DmMessage[] = []
    channel.addEventListener('message', (event: MessageEvent<unknown>) => {
      const message = parseDmMessage(event.data)
      if (message) received.push(message)
    })
    const releases: (() => void)[] = []
    cleanups.push(() => {
      channel.close()
      for (const release of releases) release()
    })
    return {
      received,
      views: () => received.filter((m) => m.type === 'view'),
      /** Like a player window: hold its own lock, then say hello. */
      hello: (clientId = 'player-1') =>
        new Promise<void>((ready) => {
          void navigator.locks.request(playerLockName(clientId), () => {
            ready()
            return new Promise<void>((release) => releases.push(release))
          })
        }).then(() => post(channel, { v: 1, type: 'hello', clientId })),
      bye: (clientId = 'player-1') => post(channel, { v: 1, type: 'bye', clientId }),
      /** The window closes without a bye (crash): its lock is released. */
      crash: () => {
        for (const release of releases.splice(0)) release()
      },
    }
  }

  function dm(view: { current: PlayerViewState | null }) {
    const events: string[] = []
    const sync: DmSync = createDmSync({
      project: () => view.current,
      onPlayers: (count, change) => events.push(`${change}:${count}`),
    })
    cleanups.push(() => sync.dispose())
    return { sync, events }
  }

  it('announces itself, then answers a hello with the current view', async () => {
    const p = player()
    const view = { current: blackoutView(null) }
    const { sync, events } = dm(view)
    await wait(20)
    expect(p.received.map((m) => m.type)).toStrictEqual(['dm-online'])
    sync.invalidate()
    await wait(80)
    expect(p.views()).toHaveLength(0) // nothing is sent while no player is connected
    await p.hello()
    await wait(20)
    expect(events).toStrictEqual(['connected:1'])
    expect(sync.playerCount()).toBe(1)
    expect(p.views()).toStrictEqual([
      { v: 1, type: 'view', dm: expect.any(String), state: blackoutView(null), fogRevision: 1 },
    ])
  })

  it('sends only changed views, at most every 50 ms', async () => {
    const p = player()
    const view = { current: blackoutView(null) }
    const { sync } = dm(view)
    await p.hello()
    await wait(20)
    sync.invalidate()
    await wait(80)
    expect(p.views()).toHaveLength(1) // unchanged: not resent
    for (let i = 0; i < 10; i++) {
      view.current = blackoutView(`splash-${i}`)
      sync.invalidate()
    }
    await wait(120)
    const views = p.views()
    expect(views.length).toBeLessThanOrEqual(3)
    expect(views.at(-1)).toMatchObject({ state: blackoutView('splash-9') })
  })

  it('notices a player window that closes without saying bye', async () => {
    const p = player()
    const { events } = dm({ current: null })
    await p.hello()
    await wait(20)
    p.crash()
    await wait(20)
    expect(events).toStrictEqual(['connected:1', 'disconnected:0'])
  })

  it('a ping reaches players; a bye disconnects', async () => {
    const p = player()
    const { sync, events } = dm({ current: null })
    await p.hello()
    await wait(20)
    sync.ping({ id: 'ping-1', x: 10, y: 20, sceneId: 's1' })
    p.bye()
    await wait(20)
    expect(p.received.filter((m) => m.type === 'ping')).toStrictEqual([
      { v: 1, type: 'ping', dm: expect.any(String), id: 'ping-1', x: 10, y: 20, sceneId: 's1' },
    ])
    expect(events).toStrictEqual(['connected:1', 'disconnected:0'])
    expect(p.views()).toHaveLength(0) // no campaign: nothing to show
  })
})
