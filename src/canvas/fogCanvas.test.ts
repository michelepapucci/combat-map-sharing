import { describe, expect, it } from 'vitest'
import { encodeChunk } from '../geometry/fog'
import { exploredTiles, type ExploredTile } from '../geometry/fogRaster'
import { FOG_CHUNK_BYTES, type FogEditMode, type FogShape } from '../state/types'
import {
  EXPLORED_CLEAR,
  cachedTileImage,
  createTileImage,
  drawFog,
  tileCacheSize,
  trimTileCache,
  type FogContext,
  type FogDrawing,
} from './fogCanvas'

type Matrix = [number, number, number, number, number, number]

interface Op {
  op: string
  args: unknown[]
  composite: GlobalCompositeOperation
  alpha: number
  matrix: Matrix
  lineWidth: number
}

interface State {
  globalAlpha: number
  globalCompositeOperation: GlobalCompositeOperation
  matrix: Matrix
}

/** A 2D context that records the drawing calls with the paint state at each call. */
class FakeContext implements FogContext {
  globalAlpha = 1
  globalCompositeOperation: GlobalCompositeOperation = 'source-over'
  fillStyle: string | CanvasGradient | CanvasPattern = '#ffffff'
  strokeStyle: string | CanvasGradient | CanvasPattern = '#ffffff'
  lineWidth = 1
  lineCap: CanvasLineCap = 'butt'
  lineJoin: CanvasLineJoin = 'miter'
  imageSmoothingEnabled = false
  imageSmoothingQuality: ImageSmoothingQuality = 'low'
  matrix: Matrix
  readonly ops: Op[] = []
  private readonly stack: State[] = []

  constructor(matrix: Matrix, alpha = 1) {
    this.matrix = matrix
    this.globalAlpha = alpha
  }

  private record(op: string, args: unknown[]): void {
    this.ops.push({
      op,
      args,
      composite: this.globalCompositeOperation,
      alpha: this.globalAlpha,
      matrix: this.matrix,
      lineWidth: this.lineWidth,
    })
  }

  save(): void {
    this.stack.push({
      globalAlpha: this.globalAlpha,
      globalCompositeOperation: this.globalCompositeOperation,
      matrix: this.matrix,
    })
  }
  restore(): void {
    const state = this.stack.pop()
    if (!state) throw new Error('restore without save')
    this.globalAlpha = state.globalAlpha
    this.globalCompositeOperation = state.globalCompositeOperation
    this.matrix = state.matrix
  }
  get depth(): number {
    return this.stack.length
  }
  getTransform(): DOMMatrix {
    const [a, b, c, d, e, f] = this.matrix
    return { a, b, c, d, e, f } as DOMMatrix
  }
  setTransform(...args: unknown[]): void {
    this.matrix = args.map(Number) as Matrix
  }
  fillRect(...args: unknown[]): void {
    this.record('fillRect', args)
  }
  beginPath(): void {
    this.record('beginPath', [])
  }
  closePath(): void {}
  rect(...args: unknown[]): void {
    this.record('rect', args)
  }
  arc(...args: unknown[]): void {
    this.record('arc', args)
  }
  moveTo(...args: unknown[]): void {
    this.record('moveTo', args)
  }
  lineTo(...args: unknown[]): void {
    this.record('lineTo', args)
  }
  fill(...args: unknown[]): void {
    this.record('fill', args)
  }
  stroke(): void {
    this.record('stroke', [])
  }
  clip(): void {
    this.record('clip', [])
  }
  drawImage(...args: unknown[]): void {
    this.record('drawImage', args)
  }

  /** The paint operations only (what changes pixels). */
  paints(): Op[] {
    return this.ops.filter((op) => ['fillRect', 'fill', 'stroke', 'drawImage'].includes(op.op))
  }
}

const IMAGE = { tile: true } as unknown as CanvasImageSource
const anyImage = () => IMAGE
const noImage = () => null

/** A mask whose chunks are fully explored, as tiles. */
function fullTiles(cellPx: number, chunks: [number, number][]): ExploredTile[] {
  const full = encodeChunk(new Uint8Array(FOG_CHUNK_BYTES).fill(255)) ?? ''
  return exploredTiles({
    cellPx,
    chunks: Object.fromEntries(chunks.map(([cx, cy]) => [`${cx},${cy}`, full])),
  }).filter((tile) => chunks.some(([cx, cy]) => tile.cx === cx && tile.cy === cy))
}

function drawing(init: Partial<FogDrawing>): FogDrawing {
  return { visible: [], tiles: [], cellPx: 1, manual: [], ...init }
}

const edit = (mode: FogEditMode, shape: FogShape) => ({ mode, shape })

describe('drawFog', () => {
  it('fills the whole canvas, then cuts explored, visible and manual regions in order', () => {
    const ctx = new FakeContext([2, 0, 0, 2, 10, 20])
    const drawn = drawFog(
      ctx,
      { width: 800, height: 600 },
      drawing({
        visible: [{ x: 50, y: 60, r: 30 }],
        tiles: fullTiles(1, [[0, 0]]),
        manual: [
          edit('reveal', { type: 'rect', x: 100, y: 100, width: -20, height: 10 }),
          edit('hide', { type: 'polygon', points: [0, 0, 10, 0, 10, 10] }),
          edit('reveal', { type: 'brush', points: [5, 5], radius: 4 }),
          edit('reveal', { type: 'brush', points: [5, 5, 25, 5, 25, 30], radius: 3 }),
        ],
      }),
      anyImage,
    )
    expect(drawn).toBe(1)
    const paints = ctx.paints().map(({ op, composite, alpha }) => [op, composite, alpha])
    expect(paints).toStrictEqual([
      ['fillRect', 'source-over', 1],
      ['drawImage', 'destination-out', EXPLORED_CLEAR],
      ['fill', 'destination-out', 1], // visible circles
      ['fill', 'destination-out', 1], // reveal rect
      ['fill', 'source-over', 1], // hide polygon: painting over is enough at full opacity
      ['fill', 'destination-out', 1], // single-point brush: a disc
      ['stroke', 'destination-out', 1], // brush stroke
    ])
    const [base, tile, , rect, polygon, disc, stroke] = ctx.paints()
    // The base covers the canvas in device px, whatever the world transform.
    expect(base?.matrix).toStrictEqual([1, 0, 0, 1, 0, 0])
    expect(base?.args).toStrictEqual([0, 0, 800, 600])
    // Chunk (0, 0) is 64 world px = 128 device px at (10, 20); the apron cell (2 px) is clipped off.
    expect(tile?.matrix).toStrictEqual([1, 0, 0, 1, 0, 0])
    expect(tile?.args).toStrictEqual([IMAGE, 8, 18, 132, 132])
    expect(ctx.ops.filter((op) => op.op === 'rect')[0]?.args).toStrictEqual([10, 20, 128, 128])
    expect(rect?.matrix).toStrictEqual([2, 0, 0, 2, 10, 20])
    expect(ctx.ops.filter((op) => op.op === 'rect')[1]?.args).toStrictEqual([80, 100, 20, 10])
    expect(polygon?.args).toStrictEqual(['evenodd'])
    expect(disc?.args).toStrictEqual([])
    expect(ctx.ops.find((op) => op.op === 'arc' && op.args[2] === 4)?.args).toStrictEqual([
      5,
      5,
      4,
      0,
      2 * Math.PI,
    ])
    expect(stroke?.lineWidth).toBe(6)
    // The state is restored: composite, alpha and transform are as they were.
    expect(ctx.depth).toBe(0)
    expect(ctx.globalCompositeOperation).toBe('source-over')
    expect(ctx.globalAlpha).toBe(1)
    expect(ctx.matrix).toStrictEqual([2, 0, 0, 2, 10, 20])
  })

  it('keeps the base opacity Konva applied (the DM tint), and a hide is exactly that base', () => {
    const ctx = new FakeContext([1, 0, 0, 1, 0, 0], 0.4)
    drawFog(
      ctx,
      { width: 100, height: 100 },
      drawing({
        tiles: fullTiles(1, [[0, 0]]),
        manual: [edit('hide', { type: 'rect', x: 0, y: 0, width: 10, height: 10 })],
      }),
      anyImage,
    )
    expect(ctx.paints().map(({ op, composite, alpha }) => [op, composite, alpha])).toStrictEqual([
      ['fillRect', 'source-over', 0.4],
      ['drawImage', 'destination-out', EXPLORED_CLEAR],
      ['fill', 'destination-out', 1], // no circles: an empty path
      ['fill', 'destination-out', 1], // the hide clears its area...
      ['fill', 'source-over', 0.4], // ...then paints the base back
    ])
    expect(ctx.globalAlpha).toBe(0.4)
  })

  it('treats an unknown edit mode as a hide, like fogRegionAt', () => {
    const ctx = new FakeContext([1, 0, 0, 1, 0, 0])
    const mode = 'bogus' as FogEditMode
    drawFog(
      ctx,
      { width: 100, height: 100 },
      drawing({ manual: [edit(mode, { type: 'rect', x: 0, y: 0, width: 10, height: 10 })] }),
      anyImage,
    )
    expect(ctx.paints().at(-1)).toMatchObject({ op: 'fill', composite: 'source-over', alpha: 1 })
  })

  it('places tiles on whole device pixels so neighbors meet exactly, and culls off-screen ones', () => {
    const ctx = new FakeContext([1.37, 0, 0, 1.37, 3.3, -7.6])
    const tiles = fullTiles(17.5, [
      [0, 0],
      [1, 0],
      [0, 1],
      [40, 0], // far right of the canvas
      [-3, 0], // far left
    ])
    const drawn = drawFog(
      ctx,
      { width: 3000, height: 3000 },
      drawing({ tiles, cellPx: 17.5 }),
      anyImage,
    )
    expect(drawn).toBe(3)
    const clips = ctx.ops
      .filter((op) => op.op === 'rect')
      .map(({ args }) => args.map(Number))
      .map(([x = 0, y = 0, w = 0, h = 0]) => ({ x0: x, y0: y, x1: x + w, y1: y + h }))
    for (const clip of clips) {
      for (const value of Object.values(clip)) expect(Number.isInteger(value)).toBe(true)
    }
    const [a, b, c] = clips
    expect(b?.x0).toBe(a?.x1) // (1, 0) starts where (0, 0) ends
    expect(c?.y0).toBe(a?.y1) // (0, 1) starts where (0, 0) ends
  })

  it('in a rotated transform, draws tiles in world px and culls them against cover', () => {
    const angle = Math.PI / 6
    const ctx = new FakeContext([
      Math.cos(angle),
      Math.sin(angle),
      -Math.sin(angle),
      Math.cos(angle),
      0,
      0,
    ])
    const tiles = fullTiles(1, [
      [0, 0],
      [10, 10],
    ])
    const drawn = drawFog(ctx, { width: 500, height: 500 }, drawing({ tiles }), anyImage, {
      x: -10,
      y: -10,
      width: 100,
      height: 100,
    })
    expect(drawn).toBe(1)
    expect(ctx.ops.find((op) => op.op === 'drawImage')?.args).toStrictEqual([IMAGE, -1, -1, 66, 66])
  })

  it('skips malformed shapes and circles, and draws nothing explored without tile images (fail closed)', () => {
    const ctx = new FakeContext([1, 0, 0, 1, 0, 0])
    const drawn = drawFog(
      ctx,
      { width: 100, height: 100 },
      drawing({
        visible: [
          { x: NaN, y: 0, r: 10 },
          { x: 0, y: 0, r: 0 },
        ],
        tiles: fullTiles(1, [[0, 0]]),
        manual: [
          edit('reveal', { type: 'rect', x: NaN, y: 0, width: 10, height: 10 }),
          edit('reveal', { type: 'polygon', points: [0, 0, 10, 0] }),
          edit('reveal', { type: 'polygon', points: [0, 0, 10, 0, Infinity, 5] }),
          edit('reveal', { type: 'brush', points: [0, 0], radius: 0 }),
          edit('reveal', { type: 'brush', points: [], radius: 5 }),
          edit('hide', { type: 'brush', points: [0, NaN], radius: 5 }),
        ],
      }),
      noImage,
    )
    expect(drawn).toBe(0)
    expect(ctx.ops.filter((op) => op.op === 'arc')).toStrictEqual([])
    expect(ctx.paints().map(({ op }) => op)).toStrictEqual(['fillRect', 'fill'])
  })
})

describe('tile canvases', () => {
  it('imports and runs without a DOM: no canvases, nothing cached', () => {
    const [tile] = fullTiles(1, [[0, 0]])
    if (!tile) throw new Error('missing tile')
    expect(createTileImage(new Uint8ClampedArray(66 * 66 * 4))).toBeNull()
    expect(cachedTileImage(tile)).toBeNull()
    trimTileCache(0)
    expect(tileCacheSize()).toBe(0)
  })
})
