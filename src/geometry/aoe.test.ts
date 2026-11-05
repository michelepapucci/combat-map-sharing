import { describe, expect, it } from 'vitest'
import { AOE_SHAPES, type AoeShape } from '../state/types'
import {
  CONE_HALF_ANGLE,
  affectedCells,
  affectedTokenIds,
  cellCoverage,
  feetToPx,
  snapTemplateOrigin,
  templateBounds,
  templateCircle,
  templateContains,
  templateFromDrag,
  templatePolygon,
  type AoeGrid,
  type TemplateGeometry,
} from './aoe'

/** 70 px squares, 5 ft each, no offset. */
const grid: AoeGrid = { size: 70, offsetX: 0, offsetY: 0, feetPerCell: 5 }

function tpl(over: Partial<TemplateGeometry>): TemplateGeometry {
  return {
    shape: 'circle',
    originX: 0,
    originY: 0,
    sizeFt: 20,
    widthFt: 5,
    directionDeg: 0,
    ...over,
  }
}

type Cell = { i: number; j: number }

function cells(list: [number, number][]): Cell[] {
  return list.map(([i, j]) => ({ i, j }))
}

/** Cells sorted the way affectedCells returns them: by j, then i. */
function sorted(list: Cell[]): Cell[] {
  return list.toSorted((a, b) => a.j - b.j || a.i - b.i)
}

/** A medium (one-cell) token at (x, y) on the 70 px grid. */
function medium(id: string, x: number, y: number) {
  return { id, x, y, width: 70, height: 70 }
}

function expectPolygon(actual: number[] | null, expected: number[]): void {
  expect(actual).not.toBeNull()
  expect(actual).toHaveLength(expected.length)
  expected.forEach((v, k) => expect(actual?.[k]).toBeCloseTo(v, 9))
}

/** Mulberry32: a small seeded PRNG, so the random cross-checks are reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fraction of cell (i, j) inside the template, by midpoint sampling on an n × n lattice. */
function sampledCoverage(t: TemplateGeometry, g: AoeGrid, i: number, j: number, n: number): number {
  let inside = 0
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const p = {
        x: g.offsetX + (i + (a + 0.5) / n) * g.size,
        y: g.offsetY + (j + (b + 0.5) / n) * g.size,
      }
      if (templateContains(t, g, p)) inside++
    }
  }
  return inside / (n * n)
}

/** Area of a template in cells, from the shape formulas. */
function areaCells(t: TemplateGeometry, g: AoeGrid): number {
  const l = t.sizeFt / g.feetPerCell
  switch (t.shape) {
    case 'circle':
    case 'cylinder':
      return Math.PI * l * l
    case 'cone':
      return (l * l) / 2
    case 'line':
      return l * (t.widthFt / g.feetPerCell)
    case 'cube':
      return l * l
  }
}

describe('feetToPx', () => {
  it('converts feet to world px through the cell size', () => {
    expect(feetToPx(5, grid)).toBe(70)
    expect(feetToPx(30, grid)).toBe(420)
    expect(feetToPx(30, { size: 70, feetPerCell: 10 })).toBe(210)
    expect(feetToPx(7.5, { size: 100, feetPerCell: 5 })).toBe(150)
  })
})

describe('template outlines', () => {
  it('has the 5e cone half-angle: atan(1/2), about 53.13° in total', () => {
    expect(CONE_HALF_ANGLE).toBe(Math.atan(0.5))
    expect((2 * CONE_HALF_ANGLE * 180) / Math.PI).toBeCloseTo(53.13, 2)
  })

  it('gives circles and cylinders as circles, everything else as null', () => {
    expect(templateCircle(tpl({ originX: 10, originY: 20 }), grid)).toStrictEqual({
      x: 10,
      y: 20,
      r: 280,
    })
    expect(templateCircle(tpl({ shape: 'cylinder', sizeFt: 10 }), grid)).toStrictEqual({
      x: 0,
      y: 0,
      r: 140,
    })
    for (const shape of ['cone', 'line', 'cube'] as const) {
      expect(templateCircle(tpl({ shape }), grid)).toBeNull()
    }
    expect(templatePolygon(tpl({ shape: 'circle' }), grid)).toBeNull()
    expect(templatePolygon(tpl({ shape: 'cylinder' }), grid)).toBeNull()
  })

  it('draws a cone as a triangle whose far edge is as wide as it is long', () => {
    // 15 ft = 210 px, pointing east: apex, then the far corners.
    expectPolygon(
      templatePolygon(tpl({ shape: 'cone', sizeFt: 15 }), grid),
      [0, 0, 210, -105, 210, 105],
    )
    // Pointing down (+y).
    expectPolygon(
      templatePolygon(tpl({ shape: 'cone', sizeFt: 15, directionDeg: 90 }), grid),
      [0, 0, 105, 210, -105, 210],
    )
    // Any direction: apex at the origin, far edge width = length, sides at ±atan(1/2).
    const cone = templatePolygon(
      tpl({ shape: 'cone', sizeFt: 30, originX: 7, originY: -3, directionDeg: 33 }),
      grid,
    )
    expect(cone).toHaveLength(6)
    const [ax = NaN, ay = NaN, bx = NaN, by = NaN, cx = NaN, cy = NaN] = cone ?? []
    expect([ax, ay]).toStrictEqual([7, -3])
    expect(Math.hypot(bx - cx, by - cy)).toBeCloseTo(420, 9)
    const mid = { x: (bx + cx) / 2 - ax, y: (by + cy) / 2 - ay }
    expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(420, 9)
    expect((Math.atan2(mid.y, mid.x) * 180) / Math.PI).toBeCloseTo(33, 9)
    const side = Math.atan2(by - ay, bx - ax) - Math.atan2(mid.y, mid.x)
    expect(Math.abs(side)).toBeCloseTo(CONE_HALF_ANGLE, 9)
  })

  it('draws a cube from its corner, the diagonal along the direction', () => {
    // 45°: spans +x and +y from the origin, exactly.
    expect(
      templatePolygon(tpl({ shape: 'cube', sizeFt: 10, directionDeg: 45 }), grid),
    ).toStrictEqual([0, 0, 140, 0, 140, 140, 0, 140])
    // 135°: spans -x and +y.
    expect(
      templatePolygon(tpl({ shape: 'cube', sizeFt: 10, directionDeg: 135 }), grid),
    ).toStrictEqual([0, 0, 0, 140, -140, 140, -140, 0])
    // 0°: a diamond with its far corner on the +x axis.
    expectPolygon(templatePolygon(tpl({ shape: 'cube', sizeFt: 10, directionDeg: 0 }), grid), [
      0,
      0,
      140 * Math.SQRT1_2,
      -140 * Math.SQRT1_2,
      140 * Math.SQRT2,
      0,
      140 * Math.SQRT1_2,
      140 * Math.SQRT1_2,
    ])
  })

  it('draws a line as a rectangle centered on the direction axis', () => {
    const c = Math.cos(Math.PI / 6)
    const s = 0.5
    // Length 420 px along (c, s), half-width 35 px along the normal (s, -c).
    expectPolygon(
      templatePolygon(tpl({ shape: 'line', sizeFt: 30, widthFt: 5, directionDeg: 30 }), grid),
      [
        35 * s,
        -35 * c,
        420 * c + 35 * s,
        420 * s - 35 * c,
        420 * c - 35 * s,
        420 * s + 35 * c,
        -35 * s,
        35 * c,
      ],
    )
    expect(
      templatePolygon(
        tpl({ shape: 'line', originX: 70, originY: 35, sizeFt: 30, widthFt: 10 }),
        grid,
      ),
    ).toStrictEqual([70, -35, 490, -35, 490, 105, 70, 105])
  })

  it('treats every point on an edge as inside', () => {
    const cone = tpl({ shape: 'cone', sizeFt: 15 })
    expect(templateContains(cone, grid, { x: 0, y: 0 })).toBe(true)
    expect(templateContains(cone, grid, { x: 210, y: 105 })).toBe(true)
    expect(templateContains(cone, grid, { x: 100, y: 50 })).toBe(true)
    expect(templateContains(cone, grid, { x: 210, y: 0 })).toBe(true)
    expect(templateContains(cone, grid, { x: 100, y: 50.01 })).toBe(false)
    expect(templateContains(cone, grid, { x: 210.01, y: 0 })).toBe(false)
    expect(templateContains(cone, grid, { x: -0.01, y: 0 })).toBe(false)
    const circle = tpl({ shape: 'circle', sizeFt: 5, originX: 10, originY: 10 })
    expect(templateContains(circle, grid, { x: 80, y: 10 })).toBe(true)
    expect(templateContains(circle, grid, { x: 80.01, y: 10 })).toBe(false)
    expect(templateContains(circle, grid, { x: NaN, y: 10 })).toBe(false)
  })

  it('agrees with the shape definitions at random points', () => {
    const random = prng(7)
    for (let n = 0; n < 400; n++) {
      const shape = (['cone', 'line', 'cube'] as const)[n % 3] ?? 'cone'
      const t = tpl({
        shape,
        originX: random() * 200 - 100,
        originY: random() * 200 - 100,
        sizeFt: 5 + Math.floor(random() * 6) * 5,
        widthFt: 5 + random() * 10,
        directionDeg: random() * 360,
      })
      const length = feetToPx(t.sizeFt, grid)
      const rad = (t.directionDeg * Math.PI) / 180
      const u = { x: Math.cos(rad), y: Math.sin(rad) }
      for (let m = 0; m < 25; m++) {
        const p = {
          x: t.originX + (random() * 2 - 1) * length * 1.5,
          y: t.originY + (random() * 2 - 1) * length * 1.5,
        }
        const dx = p.x - t.originX
        const dy = p.y - t.originY
        const along = dx * u.x + dy * u.y
        const across = -dx * u.y + dy * u.x
        let margin: number
        if (shape === 'cone') {
          // Distance-like margins to the three sides (positive inside).
          const side = (along / 2 - Math.abs(across)) / Math.hypot(1, 0.5)
          margin = Math.min(along, length - along, side)
        } else if (shape === 'line') {
          const half = feetToPx(t.widthFt, grid) / 2
          margin = Math.min(along, length - along, half - Math.abs(across))
        } else {
          const a = { x: Math.cos(rad - Math.PI / 4), y: Math.sin(rad - Math.PI / 4) }
          const b = { x: Math.cos(rad + Math.PI / 4), y: Math.sin(rad + Math.PI / 4) }
          const pa = dx * a.x + dy * a.y
          const pb = dx * b.x + dy * b.y
          margin = Math.min(pa, length - pa, pb, length - pb)
        }
        if (Math.abs(margin) < 1e-3) continue
        expect(templateContains(t, grid, p)).toBe(margin > 0)
      }
    }
  })

  it('bounds each shape', () => {
    expect(templateBounds(tpl({ originX: 10, originY: -5, sizeFt: 10 }), grid)).toStrictEqual({
      x: -130,
      y: -145,
      width: 280,
      height: 280,
    })
    const cone = templateBounds(tpl({ shape: 'cone', sizeFt: 15, directionDeg: 90 }), grid)
    expect(cone.x).toBeCloseTo(-105, 9)
    expect(cone.y).toBeCloseTo(0, 9)
    expect(cone.width).toBeCloseTo(210, 9)
    expect(cone.height).toBeCloseTo(210, 9)
    expect(
      templateBounds(tpl({ shape: 'cube', sizeFt: 10, directionDeg: 225 }), grid),
    ).toStrictEqual({ x: -140, y: -140, width: 140, height: 140 })
    expect(templateBounds(tpl({ sizeFt: 0, originX: 3, originY: 4 }), grid)).toStrictEqual({
      x: 3,
      y: 4,
      width: 0,
      height: 0,
    })
    expect(templateBounds(tpl({ originX: NaN }), grid)).toStrictEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    })
  })
})

describe('affectedCells, center rule', () => {
  it('a 20 ft radius circle on an intersection affects the 52 cells with centers within 4 cells', () => {
    const expected: Cell[] = []
    for (let j = -6; j <= 5; j++) {
      for (let i = -6; i <= 5; i++) {
        if ((i + 0.5) ** 2 + (j + 0.5) ** 2 <= 16) expected.push({ i, j })
      }
    }
    expect(expected).toHaveLength(52)
    const result = affectedCells(tpl({ shape: 'circle', sizeFt: 20 }), grid, 'center')
    expect(result).toStrictEqual(expected)
    expect(affectedCells(tpl({ shape: 'cylinder', sizeFt: 20 }), grid, 'center')).toStrictEqual(
      expected,
    )
  })

  it('a 15 ft cone from an intersection pointing east', () => {
    expect(affectedCells(tpl({ shape: 'cone', sizeFt: 15 }), grid, 'center')).toStrictEqual(
      cells([
        [1, -1],
        [2, -1],
        [1, 0],
        [2, 0],
      ]),
    )
  })

  it('the same cone rotated by 90°, 180° and 270° gives the rotated cells', () => {
    expect(
      affectedCells(tpl({ shape: 'cone', sizeFt: 15, directionDeg: 90 }), grid, 'center'),
    ).toStrictEqual(
      cells([
        [-1, 1],
        [0, 1],
        [-1, 2],
        [0, 2],
      ]),
    )
    const east = affectedCells(tpl({ shape: 'cone', sizeFt: 30 }), grid, 'center')
    expect(east).toHaveLength(18)
    // Rotating 90° clockwise about the intersection (0, 0) maps cell (i, j) to (-j - 1, i).
    let rotated = east
    for (const direction of [90, 180, 270]) {
      rotated = sorted(rotated.map(({ i, j }) => ({ i: -j - 1, j: i })))
      expect(
        affectedCells(tpl({ shape: 'cone', sizeFt: 30, directionDeg: direction }), grid, 'center'),
      ).toStrictEqual(rotated)
    }
  })

  it('a 30 ft cone pointing east, column by column', () => {
    // Centers (i + 0.5, j + 0.5) in cells with 0 <= x <= 6 and |y| <= x / 2.
    expect(affectedCells(tpl({ shape: 'cone', sizeFt: 30 }), grid, 'center')).toStrictEqual(
      sorted(
        cells([
          [1, -1],
          [1, 0],
          [2, -1],
          [2, 0],
          [3, -2],
          [3, -1],
          [3, 0],
          [3, 1],
          [4, -2],
          [4, -1],
          [4, 0],
          [4, 1],
          [5, -3],
          [5, -2],
          [5, -1],
          [5, 0],
          [5, 1],
          [5, 2],
        ]),
      ),
    )
  })

  it('a 15 ft cone at 45° counts the centers that lie exactly on its sides', () => {
    // (1.5, 0.5) and (0.5, 1.5) lie on the sides (slopes 1/3 and 3).
    expect(
      affectedCells(tpl({ shape: 'cone', sizeFt: 15, directionDeg: 45 }), grid, 'center'),
    ).toStrictEqual(
      cells([
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
        [2, 1],
        [1, 2],
      ]),
    )
  })

  it('a 30 ft × 5 ft line from a cell edge midpoint covers exactly six cells', () => {
    const line = tpl({ shape: 'line', originX: 70, originY: 35, sizeFt: 30, widthFt: 5 })
    const six = cells([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
      [6, 0],
    ])
    expect(affectedCells(line, grid, 'center')).toStrictEqual(six)
    expect(affectedCells(line, grid, 'half')).toStrictEqual(six)
  })

  it('a 10 ft cube covers the two-by-two block its diagonal points into', () => {
    for (const rule of ['center', 'half'] as const) {
      expect(
        affectedCells(tpl({ shape: 'cube', sizeFt: 10, directionDeg: 45 }), grid, rule),
      ).toStrictEqual(
        cells([
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ]),
      )
      expect(
        affectedCells(tpl({ shape: 'cube', sizeFt: 10, directionDeg: 225 }), grid, rule),
      ).toStrictEqual(
        cells([
          [-2, -2],
          [-1, -2],
          [-2, -1],
          [-1, -1],
        ]),
      )
      expect(
        affectedCells(tpl({ shape: 'cube', sizeFt: 10, directionDeg: 135 }), grid, rule),
      ).toStrictEqual(
        cells([
          [-2, 0],
          [-1, 0],
          [-2, 1],
          [-1, 1],
        ]),
      )
    }
  })

  it('honors grid offsets', () => {
    const offset: AoeGrid = { ...grid, offsetX: 20, offsetY: 30 }
    expect(
      affectedCells(
        tpl({ shape: 'cube', sizeFt: 10, directionDeg: 45, originX: 20, originY: 30 }),
        offset,
        'center',
      ),
    ).toStrictEqual(
      cells([
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]),
    )
  })
})

describe('affectedCells, half rule and cellCoverage', () => {
  it('counts both rows under a 5 ft line lying along a grid line', () => {
    const line = tpl({ shape: 'line', originX: 0, originY: 70, sizeFt: 30, widthFt: 5 })
    expect(cellCoverage(line, grid, 2, 0)).toBe(0.5)
    expect(cellCoverage(line, grid, 2, 1)).toBe(0.5)
    expect(cellCoverage(line, grid, 2, 2)).toBe(0)
    const rows: Cell[] = []
    for (const j of [0, 1]) for (let i = 0; i < 6; i++) rows.push({ i, j })
    expect(affectedCells(line, grid, 'half')).toStrictEqual(rows)
  })

  it('gives 1 for a fully covered cell, 0 outside, the overlap in between', () => {
    // A 10 ft cube with its corner on the center of cell (0, 0): [35, 175]².
    const cube = tpl({ shape: 'cube', sizeFt: 10, directionDeg: 45, originX: 35, originY: 35 })
    expect(cellCoverage(cube, grid, 1, 1)).toBe(1)
    expect(cellCoverage(cube, grid, 0, 0)).toBe(0.25)
    expect(cellCoverage(cube, grid, 1, 0)).toBe(0.5)
    expect(cellCoverage(cube, grid, 2, 1)).toBe(0.5)
    expect(cellCoverage(cube, grid, 2, 2)).toBe(0.25)
    expect(cellCoverage(cube, grid, 3, 1)).toBe(0)
    expect(cellCoverage(cube, grid, -1, 0)).toBe(0)
  })

  it('separates the two rules where a square is covered less than half', () => {
    const cube = tpl({ shape: 'cube', sizeFt: 10, directionDeg: 45, originX: 35, originY: 35 })
    // Centers on the cube's edges count (edges are inclusive): nine cells.
    const nine: Cell[] = []
    for (let j = 0; j <= 2; j++) for (let i = 0; i <= 2; i++) nine.push({ i, j })
    expect(affectedCells(cube, grid, 'center')).toStrictEqual(nine)
    // Only the cells covered at least half: a plus sign.
    expect(affectedCells(cube, grid, 'half')).toStrictEqual(
      cells([
        [1, 0],
        [0, 1],
        [1, 1],
        [2, 1],
        [1, 2],
      ]),
    )
  })

  it('computes cone coverage exactly', () => {
    const cone = tpl({ shape: 'cone', sizeFt: 15 })
    // In cells the cone is |y| <= x / 2 for 0 <= x <= 3.
    expect(cellCoverage(cone, grid, 0, 0)).toBeCloseTo(0.25, 12)
    expect(cellCoverage(cone, grid, 1, 0)).toBeCloseTo(0.75, 12)
    expect(cellCoverage(cone, grid, 1, -1)).toBeCloseTo(0.75, 12)
    expect(cellCoverage(cone, grid, 2, 0)).toBeCloseTo(1, 12)
    expect(cellCoverage(cone, grid, 2, 1)).toBeCloseTo(0.25, 12)
    expect(cellCoverage(cone, grid, 3, 0)).toBe(0)
    expect(affectedCells(cone, grid, 'half')).toStrictEqual(
      cells([
        [1, -1],
        [2, -1],
        [1, 0],
        [2, 0],
      ]),
    )
  })

  it('computes circle coverage like a numeric integration', () => {
    const integrate = (t: TemplateGeometry, i: number, j: number): number => {
      const circle = templateCircle(t, grid)
      if (!circle) return NaN
      const n = 20_000
      const x0 = i * grid.size
      const y0 = j * grid.size
      let area = 0
      for (let k = 0; k < n; k++) {
        const x = x0 + ((k + 0.5) / n) * grid.size
        const dx = x - circle.x
        if (Math.abs(dx) >= circle.r) continue
        const h = Math.sqrt(circle.r * circle.r - dx * dx)
        const lo = Math.max(y0, circle.y - h)
        const hi = Math.min(y0 + grid.size, circle.y + h)
        area += Math.max(0, hi - lo) * (grid.size / n)
      }
      return area / (grid.size * grid.size)
    }
    const circles = [
      tpl({ shape: 'circle', sizeFt: 20 }),
      tpl({ shape: 'cylinder', sizeFt: 10, originX: 12.3, originY: -7.9 }),
      tpl({ shape: 'circle', sizeFt: 5, originX: 35, originY: 35 }),
    ]
    for (const t of circles) {
      for (let j = -5; j <= 4; j++) {
        for (let i = -5; i <= 4; i++) {
          expect(Math.abs(cellCoverage(t, grid, i, j) - integrate(t, i, j))).toBeLessThan(2e-3)
        }
      }
    }
    const big = circles[0] ?? tpl({})
    expect(cellCoverage(big, grid, 0, 0)).toBe(1)
    expect(cellCoverage(big, grid, 4, 0)).toBe(0)
    // The coverages add up to the circle's area, π · 4² cells.
    let total = 0
    for (let j = -5; j <= 4; j++)
      for (let i = -5; i <= 4; i++) total += cellCoverage(big, grid, i, j)
    expect(total).toBeCloseTo(16 * Math.PI, 9)
  })
})

describe('affectedCells, brute-force cross-check', () => {
  it('matches cell-by-cell evaluation for random templates of every shape', () => {
    const random = prng(20251105)
    for (let n = 0; n < 75; n++) {
      const shape: AoeShape = AOE_SHAPES[n % AOE_SHAPES.length] ?? 'circle'
      const g: AoeGrid =
        n % 3 === 0
          ? { size: 70, offsetX: random() * 70, offsetY: random() * 70, feetPerCell: 5 }
          : grid
      const snapped = n % 2 === 0
      const rawOrigin = { x: random() * 400 - 200, y: random() * 400 - 200 }
      const origin = snapped ? snapTemplateOrigin(shape, rawOrigin, g) : rawOrigin
      const t = tpl({
        shape,
        originX: origin.x,
        originY: origin.y,
        sizeFt: 5 * (1 + Math.floor(random() * 8)),
        widthFt: n % 4 === 0 ? 5 + random() * 10 : 5 * (1 + Math.floor(random() * 2)),
        // Non-multiples of 15° (and the odd exact one).
        directionDeg: n % 10 === 0 ? 15 * Math.floor(random() * 24) : random() * 360,
      })
      const reach = feetToPx(t.sizeFt * 1.5 + t.widthFt, g) + 2 * g.size
      const iMin = Math.floor((t.originX - reach - g.offsetX) / g.size)
      const iMax = Math.ceil((t.originX + reach - g.offsetX) / g.size)
      const jMin = Math.floor((t.originY - reach - g.offsetY) / g.size)
      const jMax = Math.ceil((t.originY + reach - g.offsetY) / g.size)
      const center: Cell[] = []
      const half: Cell[] = []
      const partial: Cell[] = []
      let total = 0
      for (let j = jMin; j <= jMax; j++) {
        for (let i = iMin; i <= iMax; i++) {
          const c = {
            x: g.offsetX + (i + 0.5) * g.size,
            y: g.offsetY + (j + 0.5) * g.size,
          }
          if (templateContains(t, g, c)) center.push({ i, j })
          const coverage = cellCoverage(t, g, i, j)
          expect(coverage).toBeGreaterThanOrEqual(0)
          expect(coverage).toBeLessThanOrEqual(1)
          total += coverage
          if (coverage >= 0.5 - 1e-9) half.push({ i, j })
          if (coverage > 0 && coverage < 1) partial.push({ i, j })
        }
      }
      expect(affectedCells(t, g, 'center')).toStrictEqual(center)
      expect(affectedCells(t, g, 'half')).toStrictEqual(half)
      expect(total).toBeCloseTo(areaCells(t, g), 6)
      // Coverage agrees with dense point sampling, on a few partly covered cells
      // and one cell from each rule.
      const probes = [
        ...partial.filter((_, k) => k % Math.max(1, Math.floor(partial.length / 6)) === 0),
        ...center.slice(0, 1),
        ...half.slice(-1),
      ]
      for (const { i, j } of probes) {
        expect(Math.abs(cellCoverage(t, g, i, j) - sampledCoverage(t, g, i, j, 100))).toBeLessThan(
          0.02,
        )
      }
    }
  })
})

describe('affectedTokenIds', () => {
  const block = tpl({ shape: 'cube', sizeFt: 10, directionDeg: 45 })

  it('finds tokens fully inside, partly inside (one cell is enough), and not outside', () => {
    const tokens = [
      medium('outside', 315, 35),
      { id: 'large', x: 140, y: 140, width: 140, height: 140 },
      medium('inside', 35, 105),
      { id: 'tiny-in', x: 60, y: 60, width: 35, height: 35 },
      { id: 'tiny-out', x: 150, y: 10, width: 35, height: 35 },
      { id: 'huge-around', x: 1000, y: 1000, width: 2100, height: 2100 },
    ]
    expect(affectedTokenIds(block, grid, 'center', tokens)).toStrictEqual([
      'large',
      'inside',
      'tiny-in',
      'huge-around',
    ])
  })

  it('counts a token straddling two cells by the centers on its box', () => {
    // A medium token centered on the grid line x = 140 covers half of cells 1 and 2.
    expect(affectedTokenIds(block, grid, 'center', [medium('straddle', 140, 35)])).toStrictEqual([
      'straddle',
    ])
    expect(affectedTokenIds(block, grid, 'center', [medium('beyond', 210, 35)])).toStrictEqual([])
  })

  it('uses the coverage rule', () => {
    const cube = tpl({ shape: 'cube', sizeFt: 10, directionDeg: 45, originX: 35, originY: 35 })
    const corner = medium('corner', 35, 35)
    expect(affectedTokenIds(cube, grid, 'center', [corner])).toStrictEqual(['corner'])
    expect(affectedTokenIds(cube, grid, 'half', [corner])).toStrictEqual([])
  })

  it('honors grid offsets', () => {
    const offset: AoeGrid = { ...grid, offsetX: 20, offsetY: 30 }
    const cube = tpl({ shape: 'cube', sizeFt: 10, directionDeg: 45, originX: 20, originY: 30 })
    const tokens = [medium('in', 55, 65), medium('right', 195, 65), medium('above-left', 15, 25)]
    expect(affectedTokenIds(cube, offset, 'center', tokens)).toStrictEqual(['in'])
    // Without the offset, (15, 25) is the center of cell (0, 0) of the moved block.
    expect(
      affectedTokenIds(tpl({ shape: 'cube', sizeFt: 10, directionDeg: 45 }), grid, 'center', [
        medium('above-left', 15, 25),
      ]),
    ).toStrictEqual(['above-left'])
  })

  it('ignores tokens with bad numbers and returns nothing for bad templates', () => {
    const tokens = [
      medium('nan', NaN, 35),
      { id: 'no-size', x: 35, y: 35, width: NaN, height: -5 },
      medium('ok', 35, 35),
    ]
    expect(affectedTokenIds(block, grid, 'center', tokens)).toStrictEqual(['no-size', 'ok'])
    expect(affectedTokenIds(tpl({ sizeFt: 0 }), grid, 'center', tokens)).toStrictEqual([])
    expect(affectedTokenIds(block, grid, 'center', [])).toStrictEqual([])
  })
})

describe('snapTemplateOrigin', () => {
  const offset: AoeGrid = { size: 70, offsetX: 10, offsetY: 20, feetPerCell: 5 }

  it('snaps circles, cylinders and lines to the half-cell lattice (lines never to corners)', () => {
    // Spheres and cylinders may start at an intersection.
    for (const shape of ['circle', 'cylinder'] as const) {
      expect(snapTemplateOrigin(shape, { x: 14, y: 18 }, offset)).toStrictEqual({ x: 10, y: 20 })
    }
    // Lines never start at an intersection: there they would straddle two rows.
    expect(snapTemplateOrigin('line', { x: 14, y: 18 }, offset)).toStrictEqual({ x: 45, y: 20 })
    expect(snapTemplateOrigin('line', { x: 12, y: 30 }, offset)).toStrictEqual({ x: 10, y: 55 })
    for (const shape of ['circle', 'cylinder', 'line'] as const) {
      // Cell center of (0, 0): (45, 55).
      expect(snapTemplateOrigin(shape, { x: 50, y: 60 }, offset)).toStrictEqual({ x: 45, y: 55 })

      // Edge midpoint.
      expect(snapTemplateOrigin(shape, { x: 82, y: 52 }, offset)).toStrictEqual({ x: 80, y: 55 })
      expect(snapTemplateOrigin(shape, { x: -30, y: -40 }, offset)).toStrictEqual({
        x: -25,
        y: -50,
      })
    }
  })

  it('snaps cones and cubes to the nearest intersection', () => {
    for (const shape of ['cone', 'cube'] as const) {
      expect(snapTemplateOrigin(shape, { x: 50, y: 60 }, offset)).toStrictEqual({ x: 80, y: 90 })
      expect(snapTemplateOrigin(shape, { x: 40, y: 50 }, offset)).toStrictEqual({ x: 10, y: 20 })
      expect(snapTemplateOrigin(shape, { x: -30, y: -40 }, offset)).toStrictEqual({
        x: -60,
        y: -50,
      })
    }
    expect(snapTemplateOrigin('cone', { x: 50, y: 60 }, grid)).toStrictEqual({ x: 70, y: 70 })
  })

  it('returns the point unchanged on a malformed grid', () => {
    const p = { x: 12, y: 34 }
    expect(snapTemplateOrigin('circle', p, { ...grid, size: 0 })).toStrictEqual(p)
    expect(snapTemplateOrigin('cube', p, { ...grid, offsetX: NaN })).toStrictEqual(p)
  })
})

describe('templateFromDrag', () => {
  const origin = { x: 35, y: 35 }
  const at = (deg: number, px: number) => ({
    x: origin.x + px * Math.cos((deg * Math.PI) / 180),
    y: origin.y + px * Math.sin((deg * Math.PI) / 180),
  })
  const free = { snapDegrees: null }

  it('rounds the size to 5 ft, at least 5 ft', () => {
    // 12 ft = 168 px, 13 ft = 182 px.
    expect(templateFromDrag('cone', origin, { x: 35 + 168, y: 35 }, grid, free)).toStrictEqual({
      sizeFt: 10,
      directionDeg: 0,
    })
    expect(templateFromDrag('line', origin, { x: 35 + 182, y: 35 }, grid, free).sizeFt).toBe(15)
    expect(templateFromDrag('circle', origin, { x: 45, y: 35 }, grid, free).sizeFt).toBe(5)
    expect(templateFromDrag('circle', origin, { x: 35, y: 35 + 350 }, grid, free)).toStrictEqual({
      sizeFt: 25,
      directionDeg: 90,
    })
    expect(
      templateFromDrag('circle', origin, { x: 35 + 140, y: 35 }, { ...grid, feetPerCell: 10 }, free)
        .sizeFt,
    ).toBe(20)
  })

  it('normalizes the direction to [0, 360)', () => {
    expect(templateFromDrag('cone', origin, { x: 35, y: 35 - 140 }, grid, free)).toStrictEqual({
      sizeFt: 10,
      directionDeg: 270,
    })
    expect(templateFromDrag('cone', origin, at(-30, 140), grid, free).directionDeg).toBeCloseTo(
      330,
      9,
    )
    expect(templateFromDrag('line', origin, at(123.4, 140), grid, free).directionDeg).toBeCloseTo(
      123.4,
      9,
    )
  })

  it('snaps the direction to multiples of snapDegrees', () => {
    const snap15 = { snapDegrees: 15 }
    expect(templateFromDrag('cone', origin, at(37, 300), grid, snap15).directionDeg).toBe(30)
    expect(templateFromDrag('cone', origin, at(38, 300), grid, snap15).directionDeg).toBe(45)
    expect(templateFromDrag('cone', origin, at(-7, 300), grid, snap15).directionDeg).toBe(0)
    expect(templateFromDrag('line', origin, at(-8, 300), grid, snap15).directionDeg).toBe(345)
    expect(templateFromDrag('line', origin, at(181, 300), grid, snap15).directionDeg).toBe(180)
  })

  it('keeps cubes axis-aligned with (90, 45) and sizes them by the side projections', () => {
    const cubeSnap = { snapDegrees: 90, snapOffsetDeg: 45 }
    const quadrants: [number, number, number][] = [
      [100, 50, 45],
      [-100, 50, 135],
      [-100, -50, 225],
      [100, -50, 315],
      // On a quadrant boundary the tie goes to the larger angle (Math.round).
      [100, 0, 45],
      [0, 100, 135],
    ]
    for (const [dx, dy, direction] of quadrants) {
      expect(
        templateFromDrag('cube', origin, { x: 35 + dx, y: 35 + dy }, grid, cubeSnap).directionDeg,
      ).toBe(direction)
    }
    // A drag to (3, 1) cells: the square must reach the pointer, so 3 cells = 15 ft.
    expect(
      templateFromDrag('cube', origin, { x: 35 + 210, y: 35 + 70 }, grid, cubeSnap),
    ).toStrictEqual({ sizeFt: 15, directionDeg: 45 })
    expect(
      templateFromDrag('cube', origin, { x: 35 - 70, y: 35 + 210 }, grid, cubeSnap),
    ).toStrictEqual({ sizeFt: 15, directionDeg: 135 })
    // Without snapping, a diagonal drag is the square's diagonal.
    expect(
      templateFromDrag('cube', origin, { x: 35 + 140, y: 35 + 140 }, grid, free),
    ).toStrictEqual({ sizeFt: 10, directionDeg: 45 })
  })

  it('keeps the fallback direction for a zero-length drag', () => {
    expect(
      templateFromDrag('cone', origin, origin, grid, {
        snapDegrees: null,
        fallbackDirectionDeg: 120,
      }),
    ).toStrictEqual({ sizeFt: 5, directionDeg: 120 })
    expect(templateFromDrag('cone', origin, origin, grid, free)).toStrictEqual({
      sizeFt: 5,
      directionDeg: 0,
    })
    expect(
      templateFromDrag('line', origin, origin, grid, {
        snapDegrees: 15,
        fallbackDirectionDeg: -90,
      }),
    ).toStrictEqual({ sizeFt: 5, directionDeg: 270 })
    expect(
      templateFromDrag('cube', origin, origin, grid, {
        snapDegrees: 90,
        snapOffsetDeg: 45,
        fallbackDirectionDeg: 135,
      }),
    ).toStrictEqual({ sizeFt: 5, directionDeg: 135 })
  })

  it('never returns non-finite values', () => {
    const result = templateFromDrag('circle', origin, { x: NaN, y: 0 }, grid, free)
    expect(result).toStrictEqual({ sizeFt: 5, directionDeg: 0 })
    expect(
      templateFromDrag('circle', origin, { x: 35 - 100, y: 35 }, { ...grid, size: 0 }, free),
    ).toStrictEqual({ sizeFt: 5, directionDeg: 180 })
  })
})

describe('malformed input', () => {
  const bad: [string, TemplateGeometry, AoeGrid][] = [
    ['NaN origin', tpl({ originX: NaN }), grid],
    ['infinite origin', tpl({ shape: 'cone', originY: Infinity }), grid],
    ['zero size', tpl({ sizeFt: 0 }), grid],
    ['negative size', tpl({ shape: 'cube', sizeFt: -10 }), grid],
    ['NaN size', tpl({ shape: 'line', sizeFt: NaN }), grid],
    ['NaN direction', tpl({ shape: 'cone', directionDeg: NaN }), grid],
    ['zero line width', tpl({ shape: 'line', widthFt: 0 }), grid],
    ['NaN line width', tpl({ shape: 'line', widthFt: NaN }), grid],
    ['zero grid size', tpl({}), { ...grid, size: 0 }],
    ['negative grid size', tpl({ shape: 'cone' }), { ...grid, size: -70 }],
    ['zero feet per cell', tpl({}), { ...grid, feetPerCell: 0 }],
    ['NaN grid offset', tpl({ shape: 'cube' }), { ...grid, offsetY: NaN }],
    ['unknown shape', tpl({ shape: 'hexagon' as AoeShape }), grid],
  ]

  it.each(bad)('%s covers nothing', (_, t, g) => {
    expect(affectedCells(t, g, 'center')).toStrictEqual([])
    expect(affectedCells(t, g, 'half')).toStrictEqual([])
    expect(cellCoverage(t, g, 0, 0)).toBe(0)
    expect(templateContains(t, g, { x: 1, y: 1 })).toBe(false)
    expect(templateCircle(t, g)).toBeNull()
    expect(templatePolygon(t, g)).toBeNull()
    const bounds = templateBounds(t, g)
    expect(bounds.width).toBe(0)
    expect(bounds.height).toBe(0)
  })

  it('ignores the width of shapes other than lines', () => {
    expect(affectedCells(tpl({ sizeFt: 5, widthFt: 0 }), grid, 'center')).toHaveLength(4)
    expect(
      affectedCells(tpl({ shape: 'cube', directionDeg: 45, widthFt: NaN }), grid, 'half'),
    ).toHaveLength(16)
  })

  it('rejects an unknown coverage rule and non-finite cells', () => {
    expect(affectedCells(tpl({}), grid, 'most' as 'half')).toStrictEqual([])
    expect(cellCoverage(tpl({}), grid, NaN, 0)).toBe(0)
  })

  it('caps the work at 250 000 cells of bounds', () => {
    // r = 240 cells: 481 × 481 = 231 361 cells of bounds.
    const ok = affectedCells(tpl({ sizeFt: 1200 }), grid, 'center')
    expect(ok.length).toBeGreaterThan(180_000)
    // r = 260 cells: 521 × 521 = 271 441 cells.
    expect(affectedCells(tpl({ sizeFt: 1300 }), grid, 'center')).toStrictEqual([])
    // A long diagonal line has large bounds even though it is thin.
    expect(
      affectedCells(tpl({ shape: 'line', originY: 35, sizeFt: 5000 }), grid, 'center'),
    ).toHaveLength(1000)
    expect(
      affectedCells(tpl({ shape: 'line', sizeFt: 5000, directionDeg: 45 }), grid, 'center'),
    ).toStrictEqual([])
  })
})
