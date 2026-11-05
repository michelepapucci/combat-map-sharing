import { rotatedExtent } from './snap'
import type { Point, Rect } from './types'

/** The rectangle spanned by two corner points, in any order. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

/** True if the rectangles overlap (touching edges count). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
  )
}

/** Axis-aligned bounds of a center-anchored, rotated item. */
export function itemBounds(item: {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}): Rect {
  const extent = rotatedExtent(item.width, item.height, item.rotation)
  return {
    x: item.x - extent.width / 2,
    y: item.y - extent.height / 2,
    width: extent.width,
    height: extent.height,
  }
}

/** Smallest rectangle containing all of them, or null for an empty list. */
export function unionRects(rects: readonly Rect[]): Rect | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.width)
    maxY = Math.max(maxY, r.y + r.height)
  }
  return rects.length === 0 ? null : { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}
