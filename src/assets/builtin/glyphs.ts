import { ellipsePath } from './svg'

/**
 * Token glyphs: original, simple filled shapes in a 24 x 24 box, drawn in one
 * color on top of the token disc. Each part is filled separately (so overlapping
 * parts never cancel out); `evenodd` parts cut holes into themselves.
 */
export interface GlyphPart {
  d: string
  evenodd: boolean
}

export const GLYPH_NAMES = ['skull', 'swords', 'shield', 'paw', 'flame', 'crown'] as const
export type GlyphName = (typeof GLYPH_NAMES)[number]

function sword(mirror: boolean): GlyphPart[] {
  const m = (x: number) => (mirror ? 24 - x : x)
  const poly = (pts: [number, number][]) =>
    pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${m(x)} ${y}`).join('') + 'Z'
  return [
    // Blade, from the guard to the tip.
    {
      d: poly([
        [8.6, 13.9],
        [18.8, 3.7],
        [20.6, 3.4],
        [20.3, 5.2],
        [10.1, 15.4],
      ]),
      evenodd: false,
    },
    // Cross guard.
    {
      d: poly([
        [5.6, 12.9],
        [6.7, 11.8],
        [12.2, 17.3],
        [11.1, 18.4],
      ]),
      evenodd: false,
    },
    // Grip and pommel.
    {
      d:
        poly([
          [7.6, 15.3],
          [8.7, 16.4],
          [5.4, 19.7],
          [4.3, 18.6],
        ]) + ellipsePath(m(4.1), 19.9, 1.3),
      evenodd: false,
    },
  ]
}

export const GLYPHS: Readonly<Record<GlyphName, readonly GlyphPart[]>> = {
  skull: [
    {
      d:
        'M12 3C7.6 3 4 6.2 4 10.4c0 2.5 1.3 4.6 3.2 5.9V19c0 .6.4 1 1 1h7.6c.6 0 1-.4 1-1v-2.7' +
        'c1.9-1.3 3.2-3.4 3.2-5.9C20 6.2 16.4 3 12 3Z' +
        ellipsePath(8.8, 11, 2.1) +
        ellipsePath(15.2, 11, 2.1) +
        'M12 13.8l1.3 2.3h-2.6Z' +
        'M10.1 17.6h1.1V20h-1.1Z' +
        'M12.8 17.6h1.1V20h-1.1Z',
      evenodd: true,
    },
  ],
  swords: [...sword(false), ...sword(true)],
  shield: [
    {
      d:
        'M12 2.5 4 5.4v6.2c0 5 3.4 8.7 8 9.9 4.6-1.2 8-4.9 8-9.9V5.4Z' +
        'M12 5.1 6.3 7.2v4.4c0 3.6 2.3 6.4 5.7 7.6Z',
      evenodd: true,
    },
  ],
  paw: [
    {
      d:
        'M12 12.3c-3.1 0-5.6 2.7-5.6 5.1 0 1.6 1.2 2.6 2.7 2.6 1.1 0 1.9-.5 2.9-.5s1.8.5 2.9.5' +
        'c1.5 0 2.7-1 2.7-2.6 0-2.4-2.5-5.1-5.6-5.1Z',
      evenodd: false,
    },
    { d: ellipsePath(5.6, 10.6, 1.9, 2.4), evenodd: false },
    { d: ellipsePath(9.3, 6.4, 2, 2.6), evenodd: false },
    { d: ellipsePath(14.7, 6.4, 2, 2.6), evenodd: false },
    { d: ellipsePath(18.4, 10.6, 1.9, 2.4), evenodd: false },
  ],
  flame: [
    {
      d:
        'M12 2.5c.8 3-1 4.6-2.6 6.2C7.7 10.4 6 12.3 6 15.2 6 18.9 8.7 21.5 12 21.5s6-2.6 6-6.3' +
        'c0-2.6-1.3-4.6-2.6-6 .1 1.6-.5 3-1.6 3.6.3-3.6-1.2-6.7-1.8-9.8Z' +
        'M12 20c-1.6 0-2.8-1.2-2.8-2.8 0-1.5 1-2.5 1.9-3.4.3.9.8 1.4 1.5 1.6-.2-1 .2-2.2.9-3' +
        ' .9 1.1 1.4 2.4 1.4 3.8 0 2.2-1.3 3.8-2.8 3.8Z',
      evenodd: true,
    },
  ],
  crown: [
    {
      d:
        'M3 7.5l4.6 4.1L12 4.5l4.4 7.1L21 7.5l-1.8 10.2H4.8Z' +
        ellipsePath(12, 13.6, 1.4) +
        ellipsePath(8, 14.6, 1) +
        ellipsePath(16, 14.6, 1),
      evenodd: true,
    },
    { d: 'M4.8 18.6h14.4v1.9H4.8Z', evenodd: false },
  ],
}

/** The glyph as a standalone SVG (for library thumbnails), filled with `color`. */
export function glyphSvgBody(name: GlyphName, color: string): string {
  return GLYPHS[name]
    .map(
      (part) =>
        `<path d="${part.d}" fill="${color}"${part.evenodd ? ' fill-rule="evenodd"' : ''}/>`,
    )
    .join('')
}
