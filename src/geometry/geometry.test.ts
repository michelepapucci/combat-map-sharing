import { describe, expect, it } from 'vitest'
import { SIZE_CATEGORIES, type SizeCategory } from '../state/types'
import {
  fitRect,
  panBy,
  screenToWorld,
  stageTransform,
  visibleRect,
  worldToScreen,
  zoomAt,
  MAX_ZOOM,
  MIN_ZOOM,
} from './camera'
import { formatFeet, pathCells, segmentCells, worldDistanceFeet } from './distance'
import { calibrateFromBox, cellCenter, linesInRange, mod, nearestLine } from './grid'
import { itemBounds, rectFromPoints, rectsIntersect, unionRects } from './rect'
import { isRightAngle, rotatedExtent, snapAxis, snapCenter, snapToLine, tokenSpan } from './snap'

const viewport = { width: 800, height: 600 }

describe('camera', () => {
  const camera = { x: 100, y: 50, zoom: 2 }

  it('maps the viewport center to the camera point', () => {
    expect(screenToWorld({ x: 400, y: 300 }, camera, viewport)).toStrictEqual({ x: 100, y: 50 })
    expect(worldToScreen({ x: 100, y: 50 }, camera, viewport)).toStrictEqual({ x: 400, y: 300 })
  })

  it('round-trips screen and world coordinates', () => {
    const world = screenToWorld({ x: 13, y: 577 }, camera, viewport)
    const screen = worldToScreen(world, camera, viewport)
    expect(screen.x).toBeCloseTo(13)
    expect(screen.y).toBeCloseTo(577)
  })

  it('agrees with the Konva stage transform', () => {
    const t = stageTransform(camera, viewport)
    const world = { x: 37, y: -12 }
    const screen = worldToScreen(world, camera, viewport)
    expect(world.x * t.scale + t.x).toBeCloseTo(screen.x)
    expect(world.y * t.scale + t.y).toBeCloseTo(screen.y)
  })

  it('zooms toward the cursor, keeping the point under it fixed', () => {
    const cursor = { x: 120, y: 480 }
    const before = screenToWorld(cursor, camera, viewport)
    const next = zoomAt(camera, viewport, cursor, 3.3)
    const after = screenToWorld(cursor, next, viewport)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
    expect(next.zoom).toBe(3.3)
  })

  it('clamps zoom', () => {
    expect(zoomAt(camera, viewport, { x: 0, y: 0 }, 1000).zoom).toBe(MAX_ZOOM)
    expect(zoomAt(camera, viewport, { x: 0, y: 0 }, 0).zoom).toBe(MIN_ZOOM)
  })

  it('pans with the pointer', () => {
    const moved = panBy(camera, 20, -10)
    expect(moved).toStrictEqual({ x: 90, y: 55, zoom: 2 })
  })

  it('fits a rectangle inside the viewport', () => {
    const rect = { x: 0, y: 0, width: 1680, height: 1260 }
    const cam = fitRect(rect, viewport, 0)
    expect(cam.zoom).toBeCloseTo(600 / 1260)
    const shown = visibleRect(cam, viewport)
    expect(shown.x).toBeLessThanOrEqual(rect.x + 1e-9)
    expect(shown.y).toBeCloseTo(rect.y)
    expect(shown.x + shown.width).toBeGreaterThanOrEqual(rect.width - 1e-9)
  })
})

describe('grid', () => {
  it('finds lines and cell centers with an offset', () => {
    expect(nearestLine(104, 10, 70)).toBe(80)
    expect(nearestLine(116, 10, 70)).toBe(150)
    expect(cellCenter(104, 10, 70)).toBe(115)
    expect(cellCenter(-1, 0, 70)).toBe(-35)
    expect(mod(-5, 70)).toBe(65)
  })

  it('lists the lines in a range', () => {
    expect(linesInRange(-10, 150, 10, 70)).toStrictEqual([10, 80, 150])
    expect(linesInRange(0, 1e9, 0, 1, 5)).toHaveLength(5)
  })

  it('calibrates from a box over N x N cells', () => {
    const result = calibrateFromBox({ x: 37, y: 25, width: 216, height: 216 }, 3)
    expect(result).toStrictEqual({ size: 72, offsetX: 37, offsetY: 25 })
    const shifted = calibrateFromBox({ x: 300, y: -10, width: 140, height: 136 }, 2)
    expect(shifted?.size).toBe(69)
    expect(shifted?.offsetX).toBeCloseTo(300 % 69)
    expect(shifted?.offsetY).toBeCloseTo(59)
  })

  it('rejects calibration boxes that are too small', () => {
    expect(calibrateFromBox({ x: 0, y: 0, width: 3, height: 3 }, 1)).toBeNull()
    expect(calibrateFromBox({ x: 0, y: 0, width: 300, height: 300 }, 0)).toBeNull()
  })
})

describe('snapping', () => {
  const grid = { size: 70, offsetX: 0, offsetY: 0 }

  // SPEC §9: snapping for each size category. Odd footprints land on cell
  // centers, even ones on intersections.
  const expected: Record<SizeCategory, { center: number; cells: number }> = {
    tiny: { center: 35, cells: 1 },
    small: { center: 35, cells: 1 },
    medium: { center: 35, cells: 1 },
    large: { center: 70, cells: 2 },
    huge: { center: 105, cells: 3 },
    gargantuan: { center: 140, cells: 4 },
  }

  for (const size of SIZE_CATEGORIES) {
    it(`snaps a ${size} token to ${expected[size].cells % 2 === 1 ? 'a cell center' : 'an intersection'}`, () => {
      const span = tokenSpan(size, 70)
      expect(span).toBe(expected[size].cells * 70)
      const near = expected[size].center + 10 // within 25% of a cell
      expect(
        snapCenter({ x: near, y: near - 14 }, { width: span, height: span }, grid),
      ).toStrictEqual({
        x: expected[size].center,
        y: expected[size].center,
      })
    })
  }

  it('is magnetic: it only engages within 25% of a cell', () => {
    expect(snapAxis(35 + 17, 70, 0, 70)).toBe(35)
    expect(snapAxis(35 + 18, 70, 0, 70)).toBe(53)
    expect(snapAxis(35 + 30, 70, 0, 70, Infinity)).toBe(35)
  })

  it('respects the grid offset', () => {
    expect(snapAxis(50, 70, 10, 70)).toBe(45)
    expect(snapAxis(83, 140, 10, 70)).toBe(80)
  })

  it('snaps props by their nearer edge, so odd sizes still align one edge', () => {
    // A 1.5-cell prop: the left edge snaps when it is the closer one...
    expect(snapAxis(52.5 + 5, 105, 0, 70)).toBe(52.5)
    // ...and the right edge when that one is closer.
    expect(snapAxis(87.5 - 3, 105, 0, 70)).toBe(87.5)
  })

  it('swaps the footprint of props rotated by 90 degrees', () => {
    expect(rotatedExtent(140, 70, 90)).toStrictEqual({ width: 70, height: 140 })
    expect(rotatedExtent(140, 70, 180)).toStrictEqual({ width: 140, height: 70 })
    expect(rotatedExtent(140, 70, -90)).toStrictEqual({ width: 70, height: 140 })
    const diag = rotatedExtent(100, 100, 45)
    expect(diag.width).toBeCloseTo(141.42, 1)
    expect(isRightAngle(270.0000001)).toBe(true)
    expect(isRightAngle(45)).toBe(false)
  })

  it('snaps a single coordinate to a line', () => {
    expect(snapToLine(72, 0, 70)).toBe(70)
    expect(snapToLine(90, 0, 70)).toBe(90)
  })
})

describe('distance', () => {
  it("'five': every square is one cell, diagonals included", () => {
    expect(segmentCells(3, 3, 'five').cells).toBe(3)
    expect(segmentCells(-4, 1, 'five').cells).toBe(4)
  })

  it("'alternating': diagonals cost 1, 2, 1, 2...", () => {
    expect(segmentCells(1, 1, 'alternating').cells).toBe(1)
    expect(segmentCells(2, 2, 'alternating').cells).toBe(3)
    expect(segmentCells(3, 3, 'alternating').cells).toBe(4)
    expect(segmentCells(4, 1, 'alternating').cells).toBe(4)
    expect(segmentCells(5, 3, 'alternating').cells).toBe(6)
  })

  it("'alternating' carries the parity across path segments", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]
    expect(pathCells(path, 'alternating')).toBe(3)
    expect(pathCells(path, 'five')).toBe(2)
  })

  it("'euclidean': straight-line length", () => {
    expect(segmentCells(3, 4, 'euclidean').cells).toBe(5)
  })

  it('converts world distances to feet', () => {
    expect(worldDistanceFeet({ x: 35, y: 35 }, { x: 245, y: 105 }, 70, 5, 'five')).toBe(15)
    expect(worldDistanceFeet({ x: 0, y: 0 }, { x: 210, y: 280 }, 70, 5, 'euclidean')).toBe(25)
    expect(formatFeet(24.6)).toBe('25 ft')
  })
})

describe('rectangles', () => {
  it('builds, intersects and unites rectangles', () => {
    const a = rectFromPoints({ x: 10, y: 10 }, { x: 0, y: 30 })
    expect(a).toStrictEqual({ x: 0, y: 10, width: 10, height: 20 })
    expect(rectsIntersect(a, { x: 10, y: 30, width: 5, height: 5 })).toBe(true)
    expect(rectsIntersect(a, { x: 11, y: 30, width: 5, height: 5 })).toBe(false)
    expect(unionRects([])).toBeNull()
    expect(unionRects([a, { x: -5, y: 0, width: 1, height: 1 }])).toStrictEqual({
      x: -5,
      y: 0,
      width: 15,
      height: 30,
    })
  })

  it('bounds a rotated item', () => {
    expect(itemBounds({ x: 100, y: 100, width: 140, height: 70, rotation: 90 })).toStrictEqual({
      x: 65,
      y: 30,
      width: 70,
      height: 140,
    })
  })
})
