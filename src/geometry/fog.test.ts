import { describe, expect, it } from 'vitest'
import { sampleCampaign } from '../state/fixtures/sampleCampaign'
import {
  FOG_CHUNK,
  FOG_CHUNK_BYTES,
  type FogMask,
  type FogShape,
  type Scene,
  type Token,
} from '../state/types'
import {
  chunkKey,
  decodeChunk,
  encodeChunk,
  exploredBounds,
  fogRegionAt,
  footprintRegion,
  isExplored,
  samplePoints,
  shapeBounds,
  shapeContains,
  visionRadiusPx,
  visionSources,
  type FogRules,
} from './fog'

/** A mask with the given cells (i, j) explored, built with the real encoder. */
function maskWith(cellPx: number, cells: [number, number][]): FogMask {
  const bytes = new Map<string, Uint8Array>()
  for (const [i, j] of cells) {
    const cx = Math.floor(i / FOG_CHUNK)
    const cy = Math.floor(j / FOG_CHUNK)
    const key = chunkKey(cx, cy)
    const bits = bytes.get(key) ?? new Uint8Array(FOG_CHUNK_BYTES)
    const k = (j - cy * FOG_CHUNK) * FOG_CHUNK + (i - cx * FOG_CHUNK)
    bits[k >> 3] = (bits[k >> 3] ?? 0) | (1 << (k & 7))
    bytes.set(key, bits)
  }
  const chunks: Record<string, string> = {}
  for (const [key, bits] of bytes) {
    const data = encodeChunk(bits)
    if (data !== null) chunks[key] = data
  }
  return { cellPx, chunks }
}

/** The center of mask cell (i, j) in world px. */
const cellCenter = (mask: FogMask, i: number, j: number) => ({
  x: (i + 0.5) * mask.cellPx,
  y: (j + 0.5) * mask.cellPx,
})

function token(id: string, init: Partial<Token>): Token {
  return {
    id,
    assetId: 'builtin:token/initials',
    name: id,
    x: 0,
    y: 0,
    width: 50,
    height: 50,
    rotation: 0,
    locked: false,
    hidden: false,
    opacity: 1,
    kind: 'player',
    sizeCategory: 'medium',
    visionFt: 30,
    label: null,
    showLabel: false,
    badge: null,
    hp: null,
    conditions: [],
    color: '#3b82f6',
    dmNotes: '',
    initiativeModifier: null,
    ...init,
  }
}

function scene(
  tokens: Token[],
  tokensVisible = true,
): Pick<Scene, 'grid' | 'layers' | 'layerState'> {
  return {
    grid: {
      type: 'square',
      size: 50,
      offsetX: 0,
      offsetY: 0,
      feetPerCell: 5,
      visible: true,
      color: '#000000',
      opacity: 0.4,
    },
    layers: { map: [], props: [], tokens },
    layerState: {
      map: { locked: true, visible: true },
      props: { locked: false, visible: true },
      tokens: { locked: false, visible: tokensVisible },
    },
  }
}

describe('visionSources', () => {
  it('converts feet to world px through the grid', () => {
    expect(visionRadiusPx(60, { size: 70, feetPerCell: 5 })).toBe(840)
    expect(visionRadiusPx(30, { size: 50, feetPerCell: 5 })).toBe(300)
  })

  it('selects visible player tokens with vision, at their committed centers', () => {
    const s = scene([
      token('pc', { x: 100, y: 200, visionFt: 30 }),
      token('blind', { visionFt: null }),
      token('zero', { visionFt: 0 }),
      token('hidden', { hidden: true }),
      token('goblin', { kind: 'enemy', visionFt: 60 }),
      token('ally', { kind: 'npc', visionFt: 60, x: 5, y: 6 }),
    ])
    expect(visionSources(s, { npcVision: false })).toStrictEqual([
      { tokenId: 'pc', x: 100, y: 200, r: 300 },
    ])
  })

  it('an NPC standing under a manual hide gives no vision (its circle would give it away)', () => {
    const hide = {
      id: 'h',
      mode: 'hide' as const,
      shape: { type: 'rect' as const, x: 0, y: 0, width: 100, height: 100 },
    }
    const s = {
      ...scene([
        token('ally', { kind: 'npc', visionFt: 60, x: 50, y: 50 }),
        token('scout', { kind: 'npc', visionFt: 60, x: 500, y: 500 }),
        token('pc', { visionFt: 30, x: 60, y: 60 }),
      ]),
      fog: { manual: [hide] },
    }
    expect(visionSources(s, { npcVision: true }).map((v) => v.tokenId)).toStrictEqual([
      'scout',
      'pc',
    ])
    // A later reveal over the NPC gives its vision back.
    const revealed = {
      ...s,
      fog: { manual: [hide, { ...hide, id: 'r', mode: 'reveal' as const }] },
    }
    expect(visionSources(revealed, { npcVision: true }).map((v) => v.tokenId)).toStrictEqual([
      'ally',
      'scout',
      'pc',
    ])
  })

  it('adds NPCs with vision only when npcVision is on, never enemies', () => {
    const s = scene([
      token('ally', { kind: 'npc', visionFt: 60, x: 5, y: 6 }),
      token('mute', { kind: 'npc', visionFt: null }),
      token('goblin', { kind: 'enemy', visionFt: 60 }),
    ])
    expect(visionSources(s, { npcVision: true })).toStrictEqual([
      { tokenId: 'ally', x: 5, y: 6, r: 600 },
    ])
  })

  it('has no sources on a hidden tokens layer', () => {
    expect(visionSources(scene([token('pc', {})], false), { npcVision: true })).toStrictEqual([])
  })

  it('fails closed on malformed flags and numbers', () => {
    const s = scene([
      token('a', { hidden: undefined as unknown as boolean }),
      token('b', { visionFt: Number.NaN }),
      token('c', { x: Number.NaN }),
    ])
    expect(visionSources(s, { npcVision: false })).toStrictEqual([])
  })
})

describe('fog shapes', () => {
  it('rect: edges are inside, and a negative size is normalized', () => {
    const rect: FogShape = { type: 'rect', x: 10, y: 20, width: 30, height: 40 }
    expect(shapeContains(rect, { x: 10, y: 20 })).toBe(true)
    expect(shapeContains(rect, { x: 40, y: 60 })).toBe(true)
    expect(shapeContains(rect, { x: 25, y: 40 })).toBe(true)
    expect(shapeContains(rect, { x: 40.01, y: 40 })).toBe(false)
    expect(shapeContains(rect, { x: 25, y: 19.99 })).toBe(false)
    const flipped: FogShape = { type: 'rect', x: 40, y: 60, width: -30, height: -40 }
    expect(shapeContains(flipped, { x: 25, y: 40 })).toBe(true)
    expect(shapeBounds(flipped)).toStrictEqual({ x: 10, y: 20, width: 30, height: 40 })
  })

  it('polygon: even-odd ray casting with edges inside', () => {
    const triangle: FogShape = { type: 'polygon', points: [0, 0, 100, 0, 50, 100] }
    expect(shapeContains(triangle, { x: 50, y: 50 })).toBe(true)
    expect(shapeContains(triangle, { x: 50, y: 0 })).toBe(true) // on an edge
    expect(shapeContains(triangle, { x: 0, y: 0 })).toBe(true) // a vertex
    expect(shapeContains(triangle, { x: 90, y: 90 })).toBe(false)
    expect(shapeContains(triangle, { x: -1, y: 0 })).toBe(false)
    // A concave "U": the notch is outside.
    const u: FogShape = {
      type: 'polygon',
      points: [0, 0, 30, 0, 30, 70, 70, 70, 70, 0, 100, 0, 100, 100, 0, 100],
    }
    expect(shapeContains(u, { x: 50, y: 30 })).toBe(false)
    expect(shapeContains(u, { x: 15, y: 30 })).toBe(true)
    expect(shapeContains(u, { x: 50, y: 90 })).toBe(true)
    // Self-intersecting: even-odd leaves the doubly covered area out.
    const doubled: FogShape = {
      type: 'polygon',
      points: [0, 0, 100, 0, 100, 100, 0, 100, 0, 0, 50, 0, 50, 50, 0, 50],
    }
    expect(shapeContains(doubled, { x: 75, y: 75 })).toBe(true)
    expect(shapeContains(doubled, { x: 25, y: 25 })).toBe(false)
    expect(shapeBounds(u)).toStrictEqual({ x: 0, y: 0, width: 100, height: 100 })
  })

  it('polygon: fewer than three vertices covers nothing', () => {
    const line: FogShape = { type: 'polygon', points: [0, 0, 100, 100] }
    expect(shapeContains(line, { x: 50, y: 50 })).toBe(false)
    expect(shapeBounds(line)).toBeNull()
  })

  it('brush: a round brush along the stroke; one point is a disc', () => {
    const stroke: FogShape = { type: 'brush', points: [0, 0, 100, 0, 100, 100], radius: 10 }
    expect(shapeContains(stroke, { x: 50, y: 10 })).toBe(true)
    expect(shapeContains(stroke, { x: 50, y: 10.01 })).toBe(false)
    expect(shapeContains(stroke, { x: 107, y: 107 })).toBe(true) // round end cap: 9.9 px away
    expect(shapeContains(stroke, { x: 108, y: 108 })).toBe(false) // 11.3 px away
    expect(shapeContains(stroke, { x: -7, y: -7 })).toBe(true) // round start cap
    expect(shapeContains(stroke, { x: 50, y: 50 })).toBe(false) // inside the corner, far from both segments
    expect(shapeBounds(stroke)).toStrictEqual({ x: -10, y: -10, width: 120, height: 120 })

    const dab: FogShape = { type: 'brush', points: [20, 30], radius: 5 }
    expect(shapeContains(dab, { x: 23, y: 34 })).toBe(true)
    expect(shapeContains(dab, { x: 24, y: 34 })).toBe(false)
    expect(shapeContains({ type: 'brush', points: [], radius: 5 }, { x: 0, y: 0 })).toBe(false)
    expect(shapeBounds({ type: 'brush', points: [], radius: 5 })).toBeNull()
  })
})

describe('fog mask chunks', () => {
  it('round-trips bytes, dropping trailing zeros', () => {
    const bits = new Uint8Array(FOG_CHUNK_BYTES)
    for (let b = 0; b < 300; b++) bits[b] = (b * 37 + 11) & 0xff
    bits[299] = 7
    const data = encodeChunk(bits)
    expect(data).not.toBeNull()
    expect(atob(data ?? '').length).toBe(300)
    expect(decodeChunk(data ?? '')).toStrictEqual(bits)
  })

  it('encodes an all-zero chunk as null (the mask must not store it)', () => {
    expect(encodeChunk(new Uint8Array(FOG_CHUNK_BYTES))).toBeNull()
    expect(encodeChunk(new Uint8Array(0))).toBeNull()
  })

  it('decodes the sample fixture and zero-pads', () => {
    const bits = decodeChunk('AAEC')
    expect(bits.length).toBe(FOG_CHUNK_BYTES)
    expect(Array.from(bits.slice(0, 4))).toStrictEqual([0, 1, 2, 0])
    expect(bits.slice(3).every((b) => b === 0)).toBe(true)
    expect(encodeChunk(bits)).toBe('AAEC')
  })

  it('rejects chunks that are too long or not base64', () => {
    const tooLong = btoa('\u0001'.repeat(FOG_CHUNK_BYTES + 1))
    expect(() => decodeChunk(tooLong)).toThrow(/more than 512/)
    expect(() => decodeChunk('not base64!')).toThrow(DOMException)
    expect(() => encodeChunk(new Uint8Array(FOG_CHUNK_BYTES + 1))).toThrow(/more than 512/)
  })

  it('never writes "-0" in chunk keys', () => {
    expect(chunkKey(-0, 0)).toBe('0,0')
    expect(chunkKey(-1, 2)).toBe('-1,2')
  })
})

describe('isExplored', () => {
  it('reads cells on both sides of chunk boundaries', () => {
    const mask = maskWith(10, [
      [63, 0],
      [64, 1],
      [0, 63],
      [5, 64],
    ])
    expect(Object.keys(mask.chunks).toSorted()).toStrictEqual(['0,0', '0,1', '1,0'])
    expect(isExplored(mask, cellCenter(mask, 63, 0))).toBe(true)
    expect(isExplored(mask, cellCenter(mask, 64, 0))).toBe(false)
    expect(isExplored(mask, cellCenter(mask, 64, 1))).toBe(true)
    expect(isExplored(mask, cellCenter(mask, 0, 63))).toBe(true)
    expect(isExplored(mask, cellCenter(mask, 5, 64))).toBe(true)
    expect(isExplored(mask, cellCenter(mask, 5, 63))).toBe(false)
    // Cell (i, j) covers [i * cellPx, (i + 1) * cellPx): the far edge belongs to the next cell.
    expect(isExplored(mask, { x: 630, y: 0 })).toBe(true)
    expect(isExplored(mask, { x: 639.99, y: 9.99 })).toBe(true)
    expect(isExplored(mask, { x: 640, y: 0 })).toBe(false)
  })

  it('handles negative coordinates', () => {
    const mask = maskWith(10, [
      [-1, -1],
      [-64, 0],
      [-65, -65],
    ])
    expect(Object.keys(mask.chunks).toSorted()).toStrictEqual(['-1,-1', '-1,0', '-2,-2'])
    expect(isExplored(mask, { x: -0.1, y: -0.1 })).toBe(true)
    expect(isExplored(mask, { x: -10, y: -10 })).toBe(true)
    expect(isExplored(mask, { x: -10.01, y: -5 })).toBe(false)
    expect(isExplored(mask, { x: 0, y: 0 })).toBe(false)
    expect(isExplored(mask, cellCenter(mask, -64, 0))).toBe(true)
    expect(isExplored(mask, cellCenter(mask, -63, 0))).toBe(false)
    expect(isExplored(mask, cellCenter(mask, -65, -65))).toBe(true)
  })

  it('reads the sample fixture', () => {
    const mask = sampleCampaign.sceneMemory['scene-1']?.explored
    if (!mask) throw new Error('fixture has no explored mask')
    // '0,0' = AAEC: bytes 0, 1, 2 -> cells 8 and 17 of row 0.
    expect(isExplored(mask, cellCenter(mask, 8, 0))).toBe(true)
    expect(isExplored(mask, cellCenter(mask, 17, 0))).toBe(true)
    expect(isExplored(mask, cellCenter(mask, 7, 0))).toBe(false)
    expect(isExplored(mask, cellCenter(mask, 16, 0))).toBe(false)
    // '-1,2' = gA== (0x80): cell 7 of the chunk = global (-57, 128).
    expect(isExplored(mask, cellCenter(mask, -57, 128))).toBe(true)
    expect(isExplored(mask, cellCenter(mask, -58, 128))).toBe(false)
  })

  it('fails closed on malformed input', () => {
    const mask: FogMask = { cellPx: 10, chunks: { '0,0': '%%%', '1,0': btoa('ÿ'.repeat(600)) } }
    expect(isExplored(mask, { x: 1, y: 1 })).toBe(false)
    expect(isExplored(mask, { x: 641, y: 1 })).toBe(false)
    const ok = maskWith(10, [[0, 0]])
    expect(isExplored(ok, { x: Number.NaN, y: 1 })).toBe(false)
    expect(isExplored({ cellPx: 0, chunks: ok.chunks }, { x: 1, y: 1 })).toBe(false)
    expect(isExplored({ cellPx: 10, chunks: {} }, { x: 1, y: 1 })).toBe(false)
  })

  it('notices a mask changed in place despite the decode cache', () => {
    const mask = maskWith(10, [[0, 0]])
    expect(isExplored(mask, { x: 1, y: 1 })).toBe(true)
    mask.chunks['0,0'] = maskWith(10, [[1, 0]]).chunks['0,0'] ?? ''
    expect(isExplored(mask, { x: 1, y: 1 })).toBe(false)
    expect(isExplored(mask, { x: 11, y: 1 })).toBe(true)
  })
})

describe('exploredBounds', () => {
  it('is null for an empty mask', () => {
    expect(exploredBounds({ cellPx: 10, chunks: {} })).toBeNull()
  })

  it('bounds every explored cell across chunks, in world px', () => {
    const mask = maskWith(12.5, [
      [3, 4],
      [-70, 2],
      [100, -1],
    ])
    expect(exploredBounds(mask)).toStrictEqual({
      x: -70 * 12.5,
      y: -1 * 12.5,
      width: 171 * 12.5,
      height: 6 * 12.5,
    })
    expect(exploredBounds(maskWith(10, [[2, 3]]))).toStrictEqual({
      x: 20,
      y: 30,
      width: 10,
      height: 10,
    })
  })

  it('bounds the sample fixture', () => {
    const mask = sampleCampaign.sceneMemory['scene-1']?.explored
    if (!mask) throw new Error('fixture has no explored mask')
    // Cells (8, 0), (17, 0) and (-57, 128) at 17.5 px.
    expect(exploredBounds(mask)).toStrictEqual({
      x: -57 * 17.5,
      y: 0,
      width: 75 * 17.5,
      height: 129 * 17.5,
    })
  })

  it('skips malformed chunks and keys', () => {
    const good = maskWith(10, [[1, 1]])
    const mask: FogMask = {
      cellPx: 10,
      chunks: { ...good.chunks, '5,5': '%%%', 'x,y': good.chunks['0,0'] ?? '' },
    }
    expect(exploredBounds(mask)).toStrictEqual({ x: 10, y: 10, width: 10, height: 10 })
  })
})

describe('fogRegionAt', () => {
  const circles = [{ x: 0, y: 0, r: 100 }]
  const explored = maskWith(10, [[50, 0]]) // world [500, 510) x [0, 10)
  const on: FogRules = { enabled: true, exploredEnabled: true, manual: [] }
  const rules = (manual: FogRules['manual']): FogRules => ({ ...on, manual })

  it('is visible everywhere when fog is off', () => {
    const off: FogRules = { enabled: false, exploredEnabled: true, manual: [] }
    expect(fogRegionAt({ x: 9999, y: 9999 }, off, [], null)).toBe('visible')
  })

  it('is visible in a circle (edge included), explored in memory, dark elsewhere', () => {
    expect(fogRegionAt({ x: 60, y: 80 }, on, circles, explored)).toBe('visible')
    expect(fogRegionAt({ x: 100, y: 0 }, on, circles, explored)).toBe('visible')
    expect(fogRegionAt({ x: 100.01, y: 0 }, on, circles, explored)).toBe('dark')
    expect(fogRegionAt({ x: 505, y: 5 }, on, circles, explored)).toBe('explored')
    expect(fogRegionAt({ x: 505, y: 5 }, on, circles, null)).toBe('dark')
  })

  it('ignores explored memory when it is turned off', () => {
    const noMemory: FogRules = { enabled: true, exploredEnabled: false, manual: [] }
    expect(fogRegionAt({ x: 505, y: 5 }, noMemory, circles, explored)).toBe('dark')
  })

  it('applies manual edits in order on top of automatic fog', () => {
    const square: FogShape = { type: 'rect', x: 490, y: -10, width: 30, height: 30 }
    const reveal = { mode: 'reveal', shape: square } as const
    const hide = { mode: 'hide', shape: square } as const
    const p = { x: 505, y: 5 }
    expect(fogRegionAt(p, rules([reveal]), circles, explored)).toBe('visible')
    expect(fogRegionAt(p, rules([hide]), circles, explored)).toBe('dark')
    expect(fogRegionAt(p, rules([reveal, hide]), circles, explored)).toBe('dark')
    expect(fogRegionAt(p, rules([hide, reveal]), circles, explored)).toBe('visible')
    // A hide overrides vision; edits elsewhere change nothing.
    const hideCenter = {
      mode: 'hide',
      shape: { type: 'rect', x: -5, y: -5, width: 10, height: 10 },
    } as const
    expect(fogRegionAt({ x: 0, y: 0 }, rules([hideCenter]), circles, explored)).toBe('dark')
    expect(fogRegionAt({ x: 50, y: 0 }, rules([hideCenter]), circles, explored)).toBe('visible')
  })

  it('treats a NaN point as dark', () => {
    expect(fogRegionAt({ x: Number.NaN, y: 0 }, on, circles, explored)).toBe('dark')
  })
})

describe('samplePoints', () => {
  it('returns the center, corners and edge midpoints of an unrotated item', () => {
    expect(samplePoints({ x: 100, y: 50, width: 40, height: 20, rotation: 0 })).toStrictEqual([
      { x: 100, y: 50 },
      { x: 80, y: 40 },
      { x: 120, y: 40 },
      { x: 120, y: 60 },
      { x: 80, y: 60 },
      { x: 100, y: 40 },
      { x: 120, y: 50 },
      { x: 100, y: 60 },
      { x: 80, y: 50 },
    ])
  })

  it('rotates clockwise about the center, exactly at right angles', () => {
    const item = { x: 100, y: 50, width: 40, height: 20, rotation: 90 }
    const points = samplePoints(item)
    // The top edge's midpoint (100, 40) turns to the right side; top-left goes to top-right.
    expect(points[5]).toStrictEqual({ x: 110, y: 50 })
    expect(points[1]).toStrictEqual({ x: 110, y: 30 })
    expect(points[6]).toStrictEqual({ x: 100, y: 70 })
    expect(samplePoints({ ...item, rotation: -270 })).toStrictEqual(points)
    expect(samplePoints({ ...item, rotation: 450 })).toStrictEqual(points)
    const half = samplePoints({ ...item, rotation: 180 })
    expect(half[1]).toStrictEqual({ x: 120, y: 60 })
  })

  it('rotates by arbitrary angles', () => {
    const points = samplePoints({ x: 0, y: 0, width: 20, height: 20, rotation: 45 })
    const right = points[6] // midpoint of the right edge (10, 0) turns down-right
    expect(right?.x).toBeCloseTo(Math.SQRT1_2 * 10)
    expect(right?.y).toBeCloseTo(Math.SQRT1_2 * 10)
    const topLeft = points[1] // (-10, -10) turns to straight up
    expect(topLeft?.x).toBeCloseTo(0)
    expect(topLeft?.y).toBeCloseTo(-Math.SQRT2 * 10)
  })
})

describe('footprintRegion', () => {
  const on: FogRules = { enabled: true, exploredEnabled: true, manual: [] }
  const circles = [{ x: 0, y: 0, r: 100 }]
  const explored = maskWith(10, [[30, 0]]) // world [300, 310) x [0, 10)

  it('is visible when any of the nine points is visible', () => {
    // Center 160 px away, the left edge midpoint 85 px away.
    const huge = { x: 160, y: 0, width: 150, height: 150, rotation: 0 }
    expect(footprintRegion(huge, on, circles, explored)).toBe('visible')
  })

  it('misses a circle that falls between the sample points', () => {
    // The circle touches the left edge between its corner and midpoint samples.
    const item = { x: 300, y: 0, width: 400, height: 400, rotation: 0 }
    expect(footprintRegion(item, on, [{ x: 100, y: 100, r: 10 }], null)).toBe('dark')
  })

  it('is explored when no point is visible but one is explored, else dark', () => {
    expect(
      footprintRegion({ x: 290, y: 5, width: 20, height: 20, rotation: 0 }, on, circles, explored),
    ).toBe('explored')
    expect(
      footprintRegion(
        { x: 500, y: 500, width: 20, height: 20, rotation: 0 },
        on,
        circles,
        explored,
      ),
    ).toBe('dark')
  })

  it('is visible with fog off', () => {
    const off: FogRules = { enabled: false, exploredEnabled: false, manual: [] }
    expect(
      footprintRegion({ x: 9e6, y: 9e6, width: 1, height: 1, rotation: 0 }, off, [], null),
    ).toBe('visible')
  })
})
