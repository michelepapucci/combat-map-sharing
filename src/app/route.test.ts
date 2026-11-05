import { describe, expect, it } from 'vitest'
import { parseHash, ROUTE_HASH } from './route'

describe('parseHash', () => {
  it.each([
    ['', 'root'],
    ['#', 'root'],
    ['#/', 'root'],
    ['#/dm', 'dm'],
    ['#/dm/', 'dm'],
    ['#/dm?debug=1', 'dm'],
    ['#/player', 'player'],
    ['#/player/', 'player'],
  ])('parses %j as %s', (hash, name) => {
    expect(parseHash(hash).name).toBe(name)
  })

  it('reports unknown paths', () => {
    expect(parseHash('#/nope')).toEqual({ name: 'not-found', path: '/nope' })
    expect(parseHash('#/DM')).toEqual({ name: 'not-found', path: '/DM' })
  })

  it('round-trips the canonical route hashes', () => {
    expect(parseHash(ROUTE_HASH.dm).name).toBe('dm')
    expect(parseHash(ROUTE_HASH.player).name).toBe('player')
  })
})
