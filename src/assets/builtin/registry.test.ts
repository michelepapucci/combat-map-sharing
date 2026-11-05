import { describe, expect, it } from 'vitest'
import { GLYPHS } from './glyphs'
import {
  badgeStyleFor,
  getBuiltinAsset,
  INITIALS_TOKEN_ID,
  MAP_ASSETS,
  PROP_ASSETS,
  TOKEN_ASSETS,
  TOKEN_PRESETS,
} from './registry'

/** Arguments per SVG path command. */
const ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }
const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi

/** Problems in SVG path data: unknown commands or argument counts that don't fit the command. */
function pathProblems(d: string): string[] {
  const problems: string[] = []
  for (const segment of d.matchAll(/([a-z])([^a-z]*)/gi)) {
    const command = segment[1] ?? ''
    const arity = ARITY[command.toLowerCase()]
    const count = (segment[2] ?? '').match(NUMBER)?.length ?? 0
    if (arity === undefined) problems.push(`unknown command ${command}`)
    else if (arity === 0 ? count !== 0 : count === 0 || count % arity !== 0) {
      problems.push(`${command} with ${count} numbers: ${segment[0].slice(0, 40)}`)
    }
  }
  return problems
}

describe('built-in assets', () => {
  it('have unique, stable, prefixed ids', () => {
    const ids = [...TOKEN_ASSETS, ...PROP_ASSETS, ...MAP_ASSETS].map((asset) => asset.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^builtin:(token|prop|map)\/[a-z0-9-]+$/)
  })

  it('include every prop and map background the spec lists', () => {
    expect(PROP_ASSETS.map((a) => a.name)).toStrictEqual([
      'Tree',
      'Bush',
      'Rock',
      'Boulder',
      'Crate',
      'Barrel',
      'Table',
      'Chest',
      'Door',
      'Pillar',
      'Campfire',
      'Water tile',
      'Wall segment',
    ])
    expect(MAP_ASSETS.map((a) => a.name)).toStrictEqual(['Stone floor', 'Grass', 'Dirt'])
  })

  it('token presets point at token assets', () => {
    for (const preset of TOKEN_PRESETS) expect(getBuiltinAsset(preset.assetId)?.kind).toBe('token')
    expect(new Set(TOKEN_PRESETS.map((p) => p.id)).size).toBe(TOKEN_PRESETS.length)
    expect(badgeStyleFor(INITIALS_TOKEN_ID)).toBe('initials')
    expect(badgeStyleFor('builtin:token/skull')).toBe('number')
  })

  it('glyph paths are well formed', () => {
    for (const [name, parts] of Object.entries(GLYPHS)) {
      for (const part of parts)
        expect({ name, problems: pathProblems(part.d) }).toStrictEqual({ name, problems: [] })
    }
  })

  it('generate deterministic, well-formed SVG with the declared size', () => {
    for (const asset of [...PROP_ASSETS, ...MAP_ASSETS]) {
      const svg = asset.svg()
      expect(svg === asset.svg()).toBe(true)
      expect(svg).toContain(`width="${asset.width}" height="${asset.height}"`)
      expect(svg).not.toMatch(/NaN|undefined|Infinity/)
      for (const m of svg.matchAll(/ d="([^"]*)"/g)) {
        expect({ id: asset.id, problems: pathProblems(m[1] ?? '') }).toStrictEqual({
          id: asset.id,
          problems: [],
        })
      }
    }
  })
})
