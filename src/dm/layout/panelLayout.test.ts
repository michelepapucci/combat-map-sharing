import { beforeEach, describe, expect, it } from 'vitest'
import {
  bringToFront,
  clampPlacement,
  dock,
  MIN_PANEL_WIDTH,
  parsePanelLayout,
  popOut,
  revealPanel,
  setCollapsed,
  usePanelLayout,
  type PanelPlacement,
} from './panelLayout'

const VIEW = { width: 1280, height: 800 }

function placement(patch: Partial<PanelPlacement> = {}): PanelPlacement {
  return {
    floating: true,
    collapsed: false,
    x: 100,
    y: 100,
    width: 340,
    height: null,
    z: 1,
    ...patch,
  }
}

/** Stacking order of the initiative and library panels. */
function z(): number[] {
  const { panels } = usePanelLayout.getState()
  return [panels.initiative.z, panels.library.z]
}

beforeEach(() => {
  usePanelLayout.setState({ panels: parsePanelLayout(null) })
})

describe('panel layout', () => {
  it('keeps a floating panel grabbable inside the window, at a sane size', () => {
    expect(clampPlacement(placement({ x: -5000, y: -40 }), VIEW)).toMatchObject({
      x: 72 - 340,
      y: 0,
    })
    expect(clampPlacement(placement({ x: 9999, y: 9999 }), VIEW)).toMatchObject({
      x: 1280 - 72,
      y: 800 - 40,
    })
    expect(clampPlacement(placement({ width: 10, height: 5 }), VIEW)).toMatchObject({
      width: MIN_PANEL_WIDTH,
      height: 120,
    })
    expect(clampPlacement(placement({ width: 5000, height: 5000 }), VIEW)).toMatchObject({
      width: 720,
      height: 784,
    })
  })

  it('reads stored layouts defensively: bad fields fall back, unknown panels are ignored', () => {
    const parsed = parsePanelLayout({
      initiative: {
        floating: true,
        collapsed: 'yes',
        x: 300,
        y: 'top',
        width: 400,
        height: 250,
        z: 2,
      },
      library: { floating: false, collapsed: true },
      nonsense: { floating: true },
      __proto__: { floating: true },
    })
    expect(parsed.initiative).toStrictEqual({
      floating: true,
      collapsed: false,
      x: 300,
      y: 80,
      width: 400,
      height: 250,
      z: 2,
    })
    expect(parsed.library).toMatchObject({ floating: false, collapsed: true })
    expect(Object.keys(parsed)).toStrictEqual([
      'player-view',
      'initiative',
      'library',
      'layers',
      'properties',
      'scene',
    ])
    expect(parsePanelLayout('garbage').layers.floating).toBe(false)
  })

  it('pops out on top, docks back, and keeps the stacking order small', () => {
    popOut('initiative', { x: 200, y: 200, width: 300 })
    popOut('library', { x: 220, y: 220, width: 300 })
    expect(z()).toStrictEqual([1, 2])
    for (let i = 0; i < 50; i++) {
      bringToFront('initiative')
      bringToFront('library')
    }
    expect(z()).toStrictEqual([1, 2])
    bringToFront('initiative')
    expect(z()).toStrictEqual([2, 1])
    dock('initiative')
    expect(usePanelLayout.getState().panels.initiative.floating).toBe(false)
  })

  it('revealing a panel expands it and brings it to the front', () => {
    popOut('properties', { x: 0, y: 0, width: 300 })
    popOut('scene', { x: 0, y: 0, width: 300 })
    setCollapsed('properties', true)
    revealPanel('properties')
    const { properties, scene } = usePanelLayout.getState().panels
    expect(properties.collapsed).toBe(false)
    expect(properties.z).toBeGreaterThan(scene.z)
  })
})
