/** Small helpers for generating the built-in SVG artwork deterministically. */

/** Seeded PRNG (mulberry32) so generated art is identical on every machine and load. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const round = (n: number): string => String(Math.round(n * 10) / 10)

/** An SVG path for an ellipse (or circle), usable inside compound paths. */
export function ellipsePath(cx: number, cy: number, rx: number, ry = rx): string {
  return (
    `M${round(cx - rx)} ${round(cy)}` +
    `a${round(rx)} ${round(ry)} 0 1 0 ${round(2 * rx)} 0` +
    `a${round(rx)} ${round(ry)} 0 1 0 ${round(-2 * rx)} 0Z`
  )
}

/** A closed polygon path through the points. */
export function polygonPath(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`).join('') + 'Z'
}

/** An irregular "blob" polygon around (cx, cy), for rocks and pebbles. */
export function blobPoints(
  random: () => number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  corners: number,
  jitter: number,
): [number, number][] {
  const points: [number, number][] = []
  const start = random() * Math.PI * 2
  for (let i = 0; i < corners; i++) {
    const angle = start + (i / corners) * Math.PI * 2
    const k = 1 - jitter + random() * jitter * 2
    points.push([cx + Math.cos(angle) * rx * k, cy + Math.sin(angle) * ry * k])
  }
  return points
}

export function svgDocument(
  width: number,
  height: number,
  body: string,
  viewBox = `0 0 ${width} ${height}`,
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">${body}</svg>`
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
