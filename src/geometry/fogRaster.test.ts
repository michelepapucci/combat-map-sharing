import { describe, expect, it } from 'vitest'
import { FOG_CHUNK, FOG_CHUNK_BYTES, type FogMask } from '../state/types'
import {
  chunkKey,
  decodeChunk,
  encodeChunk,
  exploredBounds,
  inCircle,
  isExplored,
  type VisionCircle,
  type VisionSource,
} from './fog'
import {
  FOG_TILE,
  MAX_SHAPE_CELLS,
  emptyMask,
  exploredTiles,
  rasterizeCapsules,
  rasterizeCircles,
  rasterizeReveals,
  recordVision,
  sourcesById,
  tilePixels,
  type Capsule,
} from './fogRaster'
import type { Point } from './types'

/** Every explored cell of a mask as "i,j", read with the real decoder. */
function cellsOf(mask: FogMask): Set<string> {
  const cells = new Set<string>()
  for (const [key, data] of Object.entries(mask.chunks)) {
    const [cx = NaN, cy = NaN] = key.split(',').map(Number)
    const bits = decodeChunk(data)
    for (let k = 0; k < FOG_CHUNK * FOG_CHUNK; k++) {
      if ((((bits[k >> 3] ?? 0) >> (k & 7)) & 1) === 0) continue
      cells.add(`${cx * FOG_CHUNK + (k % FOG_CHUNK)},${cy * FOG_CHUNK + Math.floor(k / FOG_CHUNK)}`)
    }
  }
  return cells
}

const center = (cellPx: number, i: number, j: number): Point => ({
  x: (i + 0.5) * cellPx,
  y: (j + 0.5) * cellPx,
})

/** Brute force: every cell in the range whose center passes the test. */
function cellsWhere(
  cellPx: number,
  [i0, i1, j0, j1]: [number, number, number, number],
  test: (p: Point) => boolean,
): Set<string> {
  const cells = new Set<string>()
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) if (test(center(cellPx, i, j))) cells.add(`${i},${j}`)
  }
  return cells
}

/** fog.ts's segment distance rule, written out independently. */
function inCapsule({ from, to, r }: Capsule, p: Point): boolean {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length2 = dx * dx + dy * dy
  const t =
    length2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - from.x) * dx + (p.y - from.y) * dy) / length2))
  return Math.hypot(p.x - (from.x + t * dx), p.y - (from.y + t * dy)) <= r
}

const source = (tokenId: string, x: number, y: number, r = 50): VisionSource => ({
  tokenId,
  x,
  y,
  r,
})

/** A decoded chunk with the given local cells set. */
function bitsWith(cells: [number, number][]): Uint8Array {
  const bits = new Uint8Array(FOG_CHUNK_BYTES)
  for (const [i, j] of cells) {
    const k = j * FOG_CHUNK + i
    bits[k >> 3] = (bits[k >> 3] ?? 0) | (1 << (k & 7))
  }
  return bits
}

const alphaAt = (pixels: Uint8ClampedArray, x: number, y: number) =>
  pixels[(y * FOG_TILE + x) * 4 + 3]

function grow(mask: FogMask, circles: VisionCircle[]): FogMask {
  const next = rasterizeCircles(mask, circles)
  if (!next) throw new Error('expected the mask to change')
  return next
}

describe('rasterizeCircles', () => {
  it('marks exactly the cells whose center is inside the circle (inCircle)', () => {
    const circle = { x: 103, y: 87, r: 41 }
    const mask = grow(emptyMask(10), [circle])
    const expected = cellsWhere(10, [-5, 20, -5, 20], (p) => inCircle(circle, p))
    expect(cellsOf(mask)).toStrictEqual(expected)
    expect(expected.size).toBeGreaterThan(40)
    expect(isExplored(mask, { x: 103, y: 87 })).toBe(true)
    expect(isExplored(mask, { x: 103 + 41 + 6, y: 87 })).toBe(false)
  })

  it('works at negative coordinates and across chunk boundaries (64 cells)', () => {
    const circles = [
      { x: 0, y: 0, r: 5.5 },
      { x: 64, y: -64, r: 7.3 },
      { x: -128.2, y: 63.7, r: 3 },
    ]
    const mask = grow(emptyMask(1), circles)
    const expected = cellsWhere(1, [-140, 80, -80, 80], (p) => circles.some((c) => inCircle(c, p)))
    expect(cellsOf(mask)).toStrictEqual(expected)
    // Exactly the chunks holding those cells: the circle at the origin spans four.
    expect(new Set(Object.keys(mask.chunks))).toStrictEqual(new Set([...expected].map(cellChunk)))
    for (const key of ['-1,-1', '0,-1', '-1,0', '0,0', '1,-1', '0,-2', '-3,0', '-2,0']) {
      expect(mask.chunks[key]).toBeDefined()
    }
    for (const cell of expected) {
      const [i = 0, j = 0] = cell.split(',').map(Number)
      expect(isExplored(mask, center(1, i, j))).toBe(true)
    }
  })

  it('is idempotent: a second call returns null', () => {
    const circle = { x: 50, y: 50, r: 30 }
    const once = grow(emptyMask(5), [circle])
    expect(rasterizeCircles(once, [circle])).toBeNull()
    expect(rasterizeCircles(once, [{ x: 50, y: 50, r: 10 }])).toBeNull()
    expect(rasterizeCircles(once, [])).toBeNull()
  })

  it('never mutates its input and returns a fresh chunks object', () => {
    const start = grow(emptyMask(5), [{ x: -400, y: 900, r: 20 }])
    const snapshot = structuredClone(start)
    const next = grow(start, [{ x: 50, y: 50, r: 30 }])
    expect(start).toStrictEqual(snapshot)
    expect(next.chunks).not.toBe(start.chunks)
    expect(next.cellPx).toBe(5)
    // Untouched chunks are carried over as they were.
    for (const [key, data] of Object.entries(start.chunks)) expect(next.chunks[key]).toBe(data)
  })

  it('accumulates: two calls equal one call with both circles', () => {
    const a = { x: 10, y: 10, r: 25 }
    const b = { x: 40, y: -5, r: 18 }
    const both = grow(emptyMask(4), [a, b])
    const stepwise = grow(grow(emptyMask(4), [a]), [b])
    expect(cellsOf(stepwise)).toStrictEqual(cellsOf(both))
    expect(stepwise).toStrictEqual(both)
  })

  it('keeps the encoding canonical: round-trips, no all-zero chunks, no trailing zeros', () => {
    const mask = grow(emptyMask(3), [
      { x: 0, y: 0, r: 100 },
      { x: 500, y: -300, r: 7 },
    ])
    for (const [key, data] of Object.entries(mask.chunks)) {
      expect(key).toMatch(/^(?:0|-?[1-9]\d*),(?:0|-?[1-9]\d*)$/)
      expect(data).not.toBe('')
      expect(encodeChunk(decodeChunk(data))).toBe(data)
      expect(decodeChunk(data).some((byte) => byte !== 0)).toBe(true)
    }
    // A small circle near a chunk's first rows stores far fewer than FOG_CHUNK_BYTES bytes.
    const small = grow(emptyMask(1), [{ x: 2, y: 2, r: 1 }])
    expect(atob(small.chunks['0,0'] ?? '').length).toBeLessThan(FOG_CHUNK_BYTES)
  })

  it('agrees with exploredBounds', () => {
    const circle = { x: -70, y: 35, r: 52.5 }
    const mask = grow(emptyMask(17.5), [circle])
    const cells = [...cellsOf(mask)].map((cell) => cell.split(',').map(Number))
    const is = cells.map(([i = 0]) => i)
    const js = cells.map(([, j = 0]) => j)
    expect(exploredBounds(mask)).toStrictEqual({
      x: Math.min(...is) * 17.5,
      y: Math.min(...js) * 17.5,
      width: (Math.max(...is) - Math.min(...is) + 1) * 17.5,
      height: (Math.max(...js) - Math.min(...js) + 1) * 17.5,
    })
  })

  it('skips malformed shapes and masks instead of throwing or freezing', () => {
    const mask = emptyMask(10)
    expect(rasterizeCircles(mask, [{ x: NaN, y: 0, r: 10 }])).toBeNull()
    expect(rasterizeCircles(mask, [{ x: 0, y: Infinity, r: 10 }])).toBeNull()
    expect(rasterizeCircles(mask, [{ x: 0, y: 0, r: 0 }])).toBeNull()
    expect(rasterizeCircles(mask, [{ x: 0, y: 0, r: -5 }])).toBeNull()
    expect(rasterizeCircles(mask, [{ x: 0, y: 0, r: NaN }])).toBeNull()
    expect(rasterizeCircles(emptyMask(0), [{ x: 0, y: 0, r: 10 }])).toBeNull()
    expect(rasterizeCircles(emptyMask(NaN), [{ x: 0, y: 0, r: 10 }])).toBeNull()
    // Beyond the chunk coordinates the validator accepts: nothing is written.
    expect(rasterizeCircles(mask, [{ x: 1e12, y: 0, r: 10 }])).toBeNull()
    // Too many cells for one shape: skipped, quickly.
    const started = performance.now()
    expect(
      rasterizeCircles(emptyMask(1), [{ x: 0, y: 0, r: Math.sqrt(MAX_SHAPE_CELLS) }]),
    ).toBeNull()
    expect(performance.now() - started).toBeLessThan(50)
    // A bad shape does not stop the good ones.
    const next = rasterizeCircles(mask, [
      { x: NaN, y: 0, r: 10 },
      { x: 0, y: 0, r: 1e9 },
      { x: 5, y: 5, r: 1 },
    ])
    expect(next && cellsOf(next)).toStrictEqual(new Set(['0,0']))
  })

  it('stops at the per-call budget (later shapes are skipped)', () => {
    // Each circle costs about 3.8 million cells: two fit in MAX_CALL_CELLS, the third does not.
    const circles = [0, 1, 2].map((n) => ({ x: n * 3000, y: 0, r: 1100 }))
    const next = rasterizeCircles(emptyMask(1), circles)
    if (!next) throw new Error('expected a change')
    expect(isExplored(next, { x: 0, y: 0 })).toBe(true)
    expect(isExplored(next, { x: 3000, y: 0 })).toBe(true)
    expect(isExplored(next, { x: 6000, y: 0 })).toBe(false)
  })

  it('overwrites a malformed chunk it writes to (it read as unexplored anyway)', () => {
    const mask: FogMask = { cellPx: 1, chunks: { '0,0': '!!not base64', '5,5': '%%' } }
    const next = grow(mask, [{ x: 2.5, y: 2.5, r: 0.6 }])
    expect(encodeChunk(decodeChunk(next.chunks['0,0'] ?? ''))).toBe(next.chunks['0,0'])
    expect(isExplored(next, { x: 2.5, y: 2.5 })).toBe(true)
    expect(next.chunks['5,5']).toBe('%%')
  })
})

/** The chunk key of an "i,j" cell. */
function cellChunk(cell: string): string {
  const [i = 0, j = 0] = cell.split(',').map(Number)
  return chunkKey(Math.floor(i / FOG_CHUNK), Math.floor(j / FOG_CHUNK))
}

describe('rasterizeCapsules', () => {
  it('covers the corridor swept between two points, and nothing beyond r', () => {
    const capsule = { from: { x: 20, y: 30 }, to: { x: 260, y: 150 }, r: 25 }
    const next = rasterizeCapsules(emptyMask(5), [capsule])
    if (!next) throw new Error('expected a change')
    expect(cellsOf(next)).toStrictEqual(
      cellsWhere(5, [-10, 70, -10, 50], (p) => inCapsule(capsule, p)),
    )
    // The middle of the corridor, a point beside it and one past its end.
    expect(isExplored(next, { x: 140, y: 90 })).toBe(true)
    const length = Math.hypot(240, 120)
    const normal = { x: -120 / length, y: 240 / length }
    expect(isExplored(next, { x: 140 + normal.x * 32, y: 90 + normal.y * 32 })).toBe(false)
    expect(isExplored(next, { x: 140 + normal.x * 18, y: 90 + normal.y * 18 })).toBe(true)
    expect(isExplored(next, { x: 260 + (240 / length) * 32, y: 150 + (120 / length) * 32 })).toBe(
      false,
    )
  })

  it('handles horizontal, vertical and negative-direction segments', () => {
    const capsules = [
      { from: { x: 0, y: 0 }, to: { x: 0, y: 200 }, r: 10 },
      { from: { x: 300, y: -40 }, to: { x: 40, y: -40 }, r: 12.5 },
      { from: { x: -10, y: 300 }, to: { x: -200, y: 100 }, r: 7 },
    ]
    const next = rasterizeCapsules(emptyMask(4), capsules)
    if (!next) throw new Error('expected a change')
    expect(cellsOf(next)).toStrictEqual(
      cellsWhere(4, [-60, 90, -20, 90], (p) => capsules.some((c) => inCapsule(c, p))),
    )
  })

  it('is the circle when from equals to', () => {
    const circle = { x: 33, y: -21, r: 17 }
    expect(rasterizeCapsules(emptyMask(3), [{ from: circle, to: circle, r: 17 }])).toStrictEqual(
      rasterizeCircles(emptyMask(3), [circle]),
    )
  })
})

describe('recordVision', () => {
  it('adds the capsule swept by a token that moved', () => {
    const previous = sourcesById([source('a', 0, 0)])
    const next = recordVision(emptyMask(10), previous, [source('a', 300, 0)])
    if (!next) throw new Error('expected a change')
    const capsule = { from: { x: 0, y: 0 }, to: { x: 300, y: 0 }, r: 50 }
    expect(cellsOf(next)).toStrictEqual(
      cellsWhere(10, [-10, 40, -10, 10], (p) => inCapsule(capsule, p)),
    )
    expect(isExplored(next, { x: 150, y: 0 })).toBe(true)
  })

  it('adds only the current circle for a new token or one whose previous position is unusable', () => {
    for (const previous of [new Map(), sourcesById([source('a', NaN, 0)])]) {
      const next = recordVision(emptyMask(10), previous, [source('a', 300, 0)])
      if (!next) throw new Error('expected a change')
      expect(cellsOf(next)).toStrictEqual(cellsOf(grow(emptyMask(10), [{ x: 300, y: 0, r: 50 }])))
      expect(isExplored(next, { x: 150, y: 0 })).toBe(false)
    }
  })

  it('adds nothing for unchanged tokens unless asked for all; null when already explored', () => {
    const previous = sourcesById([source('a', 100, 100), source('b', 0, 0)])
    const current = [source('a', 100, 100), source('b', 0, 0)]
    expect(recordVision(emptyMask(10), previous, current)).toBeNull()
    const first = recordVision(emptyMask(10), previous, current, { all: true })
    if (!first) throw new Error('expected a change')
    expect(cellsOf(first)).toStrictEqual(
      cellsOf(
        grow(emptyMask(10), [
          { x: 100, y: 100, r: 50 },
          { x: 0, y: 0, r: 50 },
        ]),
      ),
    )
    expect(recordVision(first, previous, current, { all: true })).toBeNull()
    // A token that left the sources (hidden, vision off) adds nothing.
    expect(recordVision(first, previous, [source('a', 100, 100)], { all: true })).toBeNull()
    // A grown radius adds the bigger circle.
    const grown = recordVision(first, previous, [source('a', 100, 100, 80)])
    expect(grown && isExplored(grown, { x: 170, y: 100 })).toBe(true)
  })

  it('a moved token is recorded even when unchanged huge circles would use the budget', () => {
    // Four unchanged sources of about 2M cells each would exhaust MAX_CALL_CELLS.
    const huge = (id: string, x: number) => source(id, x, 0, 14_000)
    const previous = sourcesById([
      huge('a', 0),
      huge('b', 0),
      huge('c', 0),
      huge('d', 0),
      source('e', 0, 0),
    ])
    const current = [huge('a', 0), huge('b', 0), huge('c', 0), huge('d', 0), source('e', 50_000, 0)]
    const next = recordVision(emptyMask(17.5), previous, current, { all: true })
    expect(next && isExplored(next, { x: 30_000, y: 0 })).toBe(true)
    expect(next && isExplored(next, { x: 50_000, y: 0 })).toBe(true)
  })

  it('never records cells whose last manual edit is a hide', () => {
    const hide = {
      mode: 'hide' as const,
      shape: { type: 'rect' as const, x: 0, y: -100, width: 100, height: 200 },
    }
    const reveal = {
      mode: 'reveal' as const,
      shape: { type: 'rect' as const, x: 0, y: -100, width: 30, height: 200 },
    }
    const unknown = {
      mode: 'mist' as 'hide',
      shape: { type: 'brush' as const, points: [-60, 0], radius: 10 },
    }
    const next = recordVision(emptyMask(10), new Map(), [source('a', 0, 0, 90)], {
      manual: [hide, reveal, unknown],
    })
    if (!next) throw new Error('expected a change')
    expect(isExplored(next, { x: 50, y: 0 })).toBe(false) // hidden
    expect(isExplored(next, { x: 15, y: 0 })).toBe(true) // revealed again after the hide
    expect(isExplored(next, { x: -60, y: 0 })).toBe(false) // unknown modes hide (fail closed)
    expect(isExplored(next, { x: -30, y: 30 })).toBe(true)
    // The same rule cell by cell: vision minus the cells a hide covers last.
    const expected = cellsWhere(10, [-12, 12, -12, 12], (p) => {
      if (!inCircle({ x: 0, y: 0, r: 90 }, p)) return false
      if (Math.hypot(p.x + 60, p.y) <= 10) return false
      return !(p.x >= 30 && p.x <= 100 && p.y >= -100 && p.y <= 100)
    })
    expect(cellsOf(next)).toStrictEqual(expected)
  })
  it('uses the current radius for the swept capsule', () => {
    const next = recordVision(emptyMask(10), sourcesById([source('a', 0, 0, 100)]), [
      source('a', 400, 0, 20),
    ])
    if (!next) throw new Error('expected a change')
    expect(isExplored(next, { x: 200, y: 15 })).toBe(true)
    expect(isExplored(next, { x: 200, y: 35 })).toBe(false)
  })
})

describe('rasterizeReveals', () => {
  it('records manual reveals, except where a later hide covers them', () => {
    const next = rasterizeReveals(emptyMask(10), [
      { mode: 'reveal', shape: { type: 'rect', x: -200, y: -200, width: 100, height: 100 } },
      { mode: 'reveal', shape: { type: 'polygon', points: [500, 0, 600, 0, 550, 80] } },
      { mode: 'hide', shape: { type: 'rect', x: -150, y: -200, width: 50, height: 100 } },
      { mode: 'reveal', shape: { type: 'brush', points: [0, 500, 100, 500], radius: 20 } },
      { mode: 'reveal', shape: { type: 'rect', x: Number.NaN, y: 0, width: 10, height: 10 } },
    ])
    if (!next) throw new Error('expected a change')
    expect(isExplored(next, { x: -180, y: -150 })).toBe(true)
    expect(isExplored(next, { x: -120, y: -150 })).toBe(false) // hidden afterwards
    expect(isExplored(next, { x: 550, y: 30 })).toBe(true)
    expect(isExplored(next, { x: 505, y: 70 })).toBe(false) // outside the triangle
    expect(isExplored(next, { x: 50, y: 515 })).toBe(true)
    expect(isExplored(next, { x: 50, y: 535 })).toBe(false)
    expect(rasterizeReveals(next, [])).toBeNull()
  })
})

describe('performance', () => {
  it('rasterizes a 60 ft vision circle and a long drag quickly', () => {
    // 60 ft on a 70 px grid = 840 px; quarter-cell mask = 17.5 px.
    const started = performance.now()
    const circle = grow(emptyMask(17.5), [{ x: 1234, y: -567, r: 840 }])
    const capsule = rasterizeCapsules(circle, [
      { from: { x: 1234, y: -567 }, to: { x: 9000, y: 4000 }, r: 840 },
    ])
    const elapsed = performance.now() - started
    expect(cellsOf(circle).size).toBeGreaterThan(7000)
    expect(capsule).not.toBeNull()
    expect(elapsed).toBeLessThan(100)
  })
})

describe('chunk tiles', () => {
  it('tilePixels: opaque white for the chunk cells offset by one, the apron from the neighbors', () => {
    const neighborhood = [
      bitsWith([[63, 63]]), // (-1, -1): its bottom-right cell is the tile's top-left corner
      null,
      null,
      bitsWith([[63, 5]]), // (-1, 0): its right column is the tile's left apron
      bitsWith([
        [0, 0],
        [10, 20],
      ]),
      bitsWith([[0, 7]]), // (1, 0)
      null,
      bitsWith([[3, 0]]), // (0, 1): its top row is the tile's bottom apron
      null,
    ]
    const pixels = tilePixels(neighborhood)
    expect(pixels.length).toBe(FOG_TILE * FOG_TILE * 4)
    const set = new Set<string>()
    for (let y = 0; y < FOG_TILE; y++) {
      for (let x = 0; x < FOG_TILE; x++) if (alphaAt(pixels, x, y) !== 0) set.add(`${x},${y}`)
    }
    expect(set).toStrictEqual(new Set(['0,0', '1,1', '11,21', '0,6', '65,8', '4,65']))
    expect(
      Array.from(pixels.subarray((1 * FOG_TILE + 1) * 4, (1 * FOG_TILE + 1) * 4 + 4)),
    ).toStrictEqual([255, 255, 255, 255])
  })

  it('exploredTiles: the explored chunks plus the neighbors that need their soft edge', () => {
    const mask: FogMask = { cellPx: 10, chunks: { '0,0': encodeChunk(bitsWith([[0, 0]])) ?? '' } }
    const tiles = exploredTiles(mask)
    expect(new Set(tiles.map((tile) => chunkKey(tile.cx, tile.cy)))).toStrictEqual(
      new Set(['-1,-1', '-1,0', '0,-1', '0,0']),
    )
    const own = tiles.find((tile) => tile.cx === 0 && tile.cy === 0)
    expect(own?.neighborhood[4]).toStrictEqual(bitsWith([[0, 0]]))
    expect(own?.key.startsWith(`${mask.chunks['0,0']}|`)).toBe(true)
    // The empty neighbor's tile has only its apron corner set.
    const corner = tiles.find((tile) => tile.cx === -1 && tile.cy === -1)
    if (!corner) throw new Error('missing corner tile')
    const pixels = tilePixels(corner.neighborhood)
    expect(alphaAt(pixels, FOG_TILE - 1, FOG_TILE - 1)).toBe(255)
    expect(pixels.filter((value) => value !== 0).length).toBe(4)
  })

  it('keys tiles by content: identical tiles share a key wherever they are', () => {
    const full = encodeChunk(new Uint8Array(FOG_CHUNK_BYTES).fill(255)) ?? ''
    const chunks: Record<string, string> = {}
    for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) chunks[chunkKey(cx, cy)] = full
    const tiles = exploredTiles({ cellPx: 17.5, chunks })
    const keyAt = (cx: number, cy: number) =>
      tiles.find((tile) => tile.cx === cx && tile.cy === cy)?.key
    expect(tiles).toHaveLength(36) // 4 × 4 chunks plus a ring of 20 edge tiles
    expect(keyAt(1, 1)).toBe(keyAt(2, 2))
    expect(keyAt(1, 2)).toBe(keyAt(2, 1))
    expect(keyAt(0, 0)).not.toBe(keyAt(1, 1))
    expect(keyAt(-1, 0)).not.toBe(keyAt(0, -1))
  })

  it('treats malformed chunks and masks as unexplored', () => {
    expect(exploredTiles({ cellPx: 10, chunks: { '0,0': '!!', 'x,y': 'AQ==' } })).toStrictEqual([])
    expect(exploredTiles({ cellPx: 0, chunks: { '0,0': 'AQ==' } })).toStrictEqual([])
    expect(exploredTiles({ cellPx: 10, chunks: {} })).toStrictEqual([])
  })
})
