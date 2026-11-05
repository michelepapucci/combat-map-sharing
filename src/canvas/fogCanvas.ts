import type { VisionCircle } from '../geometry/fog'
import { FOG_TILE, tilePixels, type ExploredTile } from '../geometry/fogRaster'
import type { Rect, Size } from '../geometry/types'
import { FOG_CHUNK, type FogEditMode, type FogShape } from '../state/types'

/**
 * Drawing fog on a 2D canvas (SPEC §5.6, CLAUDE.md "Projection rule": fail
 * closed). The fog starts as an opaque base over the whole canvas and regions
 * are cut out of it with 'destination-out': explored memory partly, vision
 * circles and manual reveals fully; manual hides paint the base back. The result
 * matches fogRegionAt: base region, then the manual edits in order. Importing
 * this module never touches the DOM; tile canvases are created on first draw.
 */

/** Share of the base that explored-but-not-visible areas lose: they stay about 55 % dark. */
export const EXPLORED_CLEAR = 0.45
/** Opacity of the DM window's fog layer: a 40 % tint over dark areas, about 22 % over explored ones. */
export const DM_TINT_OPACITY = 0.4
/** Tile canvases kept between draws (more while a single draw needs more). */
export const TILE_CACHE_LIMIT = 512

/** The parts of a 2D context the fog uses (a real context, or a fake in tests). */
export type FogContext = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'getTransform'
  | 'setTransform'
  | 'fillRect'
  | 'beginPath'
  | 'closePath'
  | 'rect'
  | 'arc'
  | 'moveTo'
  | 'lineTo'
  | 'fill'
  | 'stroke'
  | 'clip'
  | 'drawImage'
  | 'globalAlpha'
  | 'globalCompositeOperation'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'lineCap'
  | 'lineJoin'
  | 'imageSmoothingEnabled'
  | 'imageSmoothingQuality'
>

/** What to draw, in world px. */
export interface FogDrawing {
  /** Vision circles: fully clear. */
  visible: readonly VisionCircle[]
  /** Explored memory as tiles (geometry/fogRaster exploredTiles); [] when explored memory is off. */
  tiles: readonly ExploredTile[]
  /** World px per mask cell of the explored mask. */
  cellPx: number
  /** Applied in order: 'reveal' clears, anything else paints the base back (like fogRegionAt). */
  manual: readonly { mode: FogEditMode; shape: FogShape }[]
}

type Matrix = Pick<DOMMatrix, 'a' | 'b' | 'c' | 'd' | 'e' | 'f'>

/**
 * Draws the fog onto `ctx`, whose current transform maps world px to device px
 * and whose current globalAlpha is the base opacity (1 for players; Konva's
 * layer opacity for the DM tint). `device` is the canvas size in device px.
 * `cover` is only used to skip off-screen tiles when the transform is rotated
 * (otherwise they are culled against the canvas). Returns the number of tiles
 * drawn. The context's state is restored afterwards.
 */
export function drawFog(
  ctx: FogContext,
  device: Size,
  fog: FogDrawing,
  tileImage: (tile: ExploredTile) => CanvasImageSource | null,
  cover: Rect | null = null,
): number {
  const base = Math.min(1, Math.max(0, ctx.globalAlpha))
  const world = ctx.getTransform()
  let drawn = 0
  ctx.save()
  try {
    ctx.imageSmoothingEnabled = true
    // Bilinear: the one-cell apron of each tile is exactly what it needs at chunk borders.
    ctx.imageSmoothingQuality = 'medium'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // 1. The opaque base over the whole canvas, in device px: nothing on screen escapes it.
    paint(ctx, 'source-over', base)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillRect(0, 0, device.width, device.height)
    setMatrix(ctx, world)

    // 2. Explored memory: partly cleared, with soft edges.
    paint(ctx, 'destination-out', EXPLORED_CLEAR)
    drawn = drawTiles(ctx, device, world, fog, tileImage, cover)

    // 3. The visible area: fully clear.
    paint(ctx, 'destination-out', 1)
    ctx.beginPath()
    for (const { x, y, r } of fog.visible) {
      if (![x, y, r].every(Number.isFinite) || !(r > 0)) continue
      ctx.moveTo(x + r, y)
      ctx.arc(x, y, r, 0, 2 * Math.PI)
    }
    ctx.fill()

    // 4. Manual edits, in order ('reveal' clears; anything else hides, like fogRegionAt).
    for (const { mode, shape } of fog.manual) {
      if (mode === 'reveal') {
        paint(ctx, 'destination-out', 1)
        drawShape(ctx, shape)
        continue
      }
      // Under a partial base (the DM tint) a hide first clears its area, so it is exactly
      // the base wherever it lands. At full opacity painting over is enough, and it never
      // lightens an anti-aliased edge drawn over areas that are already black.
      if (base < 1) {
        paint(ctx, 'destination-out', 1)
        if (!drawShape(ctx, shape)) continue
      }
      paint(ctx, 'source-over', base)
      drawShape(ctx, shape)
    }
  } finally {
    ctx.restore()
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = base
  }
  return drawn
}

function paint(ctx: FogContext, operation: GlobalCompositeOperation, alpha: number): void {
  ctx.globalCompositeOperation = operation
  ctx.globalAlpha = alpha
  ctx.fillStyle = '#000000'
  ctx.strokeStyle = '#000000'
}

function setMatrix(ctx: FogContext, m: Matrix): void {
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f)
}

/**
 * Draws each explored tile scaled to its chunk (FOG_CHUNK · cellPx world px).
 * With an axis-aligned transform (always, in this app) tiles are placed on whole
 * device pixels and clipped to their chunk, so neighbors meet without seams and
 * no pixel is cleared twice; the apron outside the clip only feeds the smoothing.
 */
function drawTiles(
  ctx: FogContext,
  device: Size,
  world: Matrix,
  fog: FogDrawing,
  tileImage: (tile: ExploredTile) => CanvasImageSource | null,
  cover: Rect | null,
): number {
  const { cellPx, tiles } = fog
  if (tiles.length === 0 || !(cellPx > 0) || !Number.isFinite(cellPx)) return 0
  const size = FOG_CHUNK * cellPx
  const aligned =
    Math.abs(world.b) < 1e-12 && Math.abs(world.c) < 1e-12 && world.a > 0 && world.d > 0
  if (aligned) ctx.setTransform(1, 0, 0, 1, 0, 0)
  let drawn = 0
  for (const tile of tiles) {
    const wx = tile.cx * size
    const wy = tile.cy * size
    let rect: Rect
    if (aligned) {
      const x0 = Math.round(world.a * wx + world.e)
      const y0 = Math.round(world.d * wy + world.f)
      const x1 = Math.round(world.a * (wx + size) + world.e)
      const y1 = Math.round(world.d * (wy + size) + world.f)
      if (x1 <= x0 || y1 <= y0 || x1 <= 0 || y1 <= 0 || x0 >= device.width || y0 >= device.height)
        continue
      rect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
    } else {
      rect = { x: wx, y: wy, width: size, height: size }
      if (cover && !overlaps(rect, cover)) continue
    }
    const image = tileImage(tile)
    if (!image) continue
    const cellW = rect.width / FOG_CHUNK
    const cellH = rect.height / FOG_CHUNK
    ctx.save()
    ctx.beginPath()
    ctx.rect(rect.x, rect.y, rect.width, rect.height)
    ctx.clip()
    ctx.drawImage(
      image,
      rect.x - cellW,
      rect.y - cellH,
      rect.width + 2 * cellW,
      rect.height + 2 * cellH,
    )
    ctx.restore()
    drawn++
  }
  if (aligned) setMatrix(ctx, world)
  return drawn
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** Flat [x0, y0, x1, y1, ...] as points, or null if a used coordinate is not finite. */
function finitePairs(flat: readonly number[]): [number, number][] | null {
  const points: [number, number][] = []
  for (let k = 0; k + 1 < flat.length; k += 2) {
    const x = flat[k]
    const y = flat[k + 1]
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
      return null
    }
    points.push([x, y])
  }
  return points
}

/**
 * Fills (or, for a brush, strokes) a manual fog shape with the current paint, as
 * fog.ts's shapeContains reads it: a normalized rect, an even-odd polygon, a round
 * brush whose single point (or a stroke that never moves) is a disc. Returns
 * false, drawing nothing, for shapes that cover nothing or hold non-finite values.
 */
function drawShape(ctx: FogContext, shape: FogShape): boolean {
  switch (shape.type) {
    case 'rect': {
      const { x, y, width, height } = shape
      if (![x, y, width, height].every(Number.isFinite)) return false
      ctx.beginPath()
      ctx.rect(Math.min(x, x + width), Math.min(y, y + height), Math.abs(width), Math.abs(height))
      ctx.fill()
      return true
    }
    case 'polygon': {
      const points = finitePairs(shape.points)
      const [first, ...rest] = points ?? []
      if (!first || rest.length < 2) return false
      ctx.beginPath()
      ctx.moveTo(first[0], first[1])
      for (const [x, y] of rest) ctx.lineTo(x, y)
      ctx.closePath()
      ctx.fill('evenodd')
      return true
    }
    case 'brush': {
      const points = finitePairs(shape.points)
      const [first, ...rest] = points ?? []
      const { radius } = shape
      if (!first || !Number.isFinite(radius) || !(radius > 0)) return false
      ctx.beginPath()
      if (rest.every(([x, y]) => x === first[0] && y === first[1])) {
        ctx.arc(first[0], first[1], radius, 0, 2 * Math.PI)
        ctx.fill()
        return true
      }
      ctx.moveTo(first[0], first[1])
      for (const [x, y] of rest) ctx.lineTo(x, y)
      ctx.lineWidth = 2 * radius
      ctx.stroke()
      return true
    }
  }
}

// ---------------------------------------------------------------------------
// Tile canvases
// ---------------------------------------------------------------------------

/** A FOG_TILE-sized canvas showing the pixels, or null without a DOM (Node, some workers). */
export function createTileImage(pixels: Uint8ClampedArray<ArrayBuffer>): CanvasImageSource | null {
  if (typeof ImageData === 'undefined') return null
  const image = new ImageData(pixels, FOG_TILE, FOG_TILE)
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = FOG_TILE
    canvas.height = FOG_TILE
    const context = canvas.getContext('2d')
    if (!context) return null
    context.putImageData(image, 0, 0)
    return canvas
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(FOG_TILE, FOG_TILE)
    const context = canvas.getContext('2d')
    if (!context) return null
    context.putImageData(image, 0, 0)
    return canvas
  }
  return null
}

/** Tile canvases by content key, least recently used first. */
const tileCache = new Map<string, CanvasImageSource>()

/**
 * The tile's canvas from the cache, built on a miss. Tiles are keyed by content,
 * so redraws (pan, zoom, unchanged views) rasterize nothing, and identical tiles
 * (fully explored chunks) share one canvas.
 */
export function cachedTileImage(tile: ExploredTile): CanvasImageSource | null {
  const hit = tileCache.get(tile.key)
  if (hit) {
    tileCache.delete(tile.key)
    tileCache.set(tile.key, hit)
    return hit
  }
  if (typeof ImageData === 'undefined') return null
  const image = createTileImage(tilePixels(tile.neighborhood))
  if (image) tileCache.set(tile.key, image)
  return image
}

/** Evicts the least recently used tiles beyond TILE_CACHE_LIMIT, keeping at least the `inUse` most recent. */
export function trimTileCache(inUse: number): void {
  const limit = Math.max(TILE_CACHE_LIMIT, inUse)
  for (const key of tileCache.keys()) {
    if (tileCache.size <= limit) break
    tileCache.delete(key)
  }
}

/** Number of cached tile canvases (for tests). */
export function tileCacheSize(): number {
  return tileCache.size
}
