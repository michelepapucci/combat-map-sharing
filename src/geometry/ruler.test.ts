import { describe, expect, it } from 'vitest'
import { rulerLabel, rulerLength, snapRulerPoint } from './ruler'

const grid = { size: 70, offsetX: 10, offsetY: 20, feetPerCell: 5 }

describe('ruler', () => {
  it('snaps points to the center of their cell, honouring the grid offset', () => {
    expect(snapRulerPoint({ x: 12, y: 21 }, grid)).toStrictEqual({ x: 45, y: 55 })
    expect(snapRulerPoint({ x: 79, y: 89 }, grid)).toStrictEqual({ x: 45, y: 55 })
    expect(snapRulerPoint({ x: 81, y: 91 }, grid)).toStrictEqual({ x: 115, y: 125 })
    expect(snapRulerPoint({ x: -1, y: 0 }, grid)).toStrictEqual({ x: -25, y: -15 })
  })

  it('measures paths with each diagonal rule, carrying the alternation across waypoints', () => {
    // Two diagonal steps, then one more diagonal after a waypoint.
    const path = [
      { x: 0, y: 0 },
      { x: 140, y: 140 },
      { x: 210, y: 210 },
    ]
    expect(rulerLength(path, grid, 'five')).toStrictEqual({ cells: 3, feet: 15 })
    expect(rulerLength(path, grid, 'alternating')).toStrictEqual({ cells: 4, feet: 20 })
    const euclidean = rulerLength(path, grid, 'euclidean')
    expect(euclidean.cells).toBeCloseTo(3 * Math.SQRT2, 6)
    expect(rulerLength([{ x: 0, y: 0 }], grid, 'five')).toStrictEqual({ cells: 0, feet: 0 })
    expect(rulerLength(path, { ...grid, size: 0 }, 'five')).toStrictEqual({ cells: 0, feet: 0 })
  })

  it('labels lengths in the campaign units, with squares', () => {
    expect(rulerLabel(30, 6, 'metric')).toBe('9 m · 6 sq')
    expect(rulerLabel(30, 6, 'imperial')).toBe('30 ft · 6 sq')
    expect(rulerLabel(21.2132, 4.24264, 'metric')).toBe('6.4 m · 4.2 sq')
  })
})
