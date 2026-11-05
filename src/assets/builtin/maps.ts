import { blobPoints, polygonPath, rng, round } from './svg'

/**
 * Built-in map backgrounds (SPEC §5.2): plain generated textures with no grid
 * drawn on them, 24 x 18 cells at the default 70 px grid. They are placed at
 * native size like uploaded maps.
 */
export interface MapArt {
  slug: string
  name: string
  width: number
  height: number
  body: () => string
}

const W = 1680
const H = 1260

function stoneFloor(): string {
  const r = rng(101)
  let s = `<rect width="${W}" height="${H}" fill="#3c3e42"/>`
  const rowH = 70
  const j = () => 2 + r() * 4
  const wobble = () => (r() - 0.5) * 5
  for (let y = 0; y < H; y += rowH) {
    let x = -Math.round(r() * 70)
    while (x < W) {
      const w = 70 + Math.round(r() * 3) * 35
      const g = 104 + Math.round(r() * 34)
      const tint = Math.round(r() * 8)
      // A flagstone: a rectangle with slightly irregular corners and edges.
      const stone: [number, number][] = [
        [x + j(), y + j()],
        [x + w / 2 + wobble(), y + 1.5 + r() * 2.5],
        [x + w - j(), y + j()],
        [x + w - 1.5 - r() * 2.5, y + rowH / 2 + wobble()],
        [x + w - j(), y + rowH - j()],
        [x + w / 2 + wobble(), y + rowH - 1.5 - r() * 2.5],
        [x + j(), y + rowH - j()],
        [x + 1.5 + r() * 2.5, y + rowH / 2 + wobble()],
      ]
      s += `<path d="${polygonPath(stone)}" fill="rgb(${g},${g + tint},${g + 4})"/>`
      if (r() < 0.45) {
        s += `<path d="${polygonPath(blobPoints(r, x + w * (0.3 + r() * 0.4), y + rowH * (0.3 + r() * 0.4), w * 0.22, rowH * 0.18, 7, 0.3))}" fill="#fff" opacity=".05"/>`
      }
      if (r() < 0.18) {
        const cx = x + w * (0.2 + r() * 0.6)
        const cy = y + 8 + r() * (rowH - 16)
        s += `<path d="M${round(cx)} ${round(cy)}l${round(r() * 24 - 12)} ${round(r() * 16 - 8)}l${round(r() * 20 - 10)} ${round(r() * 14 - 7)}" stroke="#2c2e31" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7"/>`
      }
      x += w
    }
  }
  return s
}

function speckles(
  r: () => number,
  count: number,
  colors: readonly string[],
  minR: number,
  maxR: number,
  opacity: number,
): string {
  let s = ''
  for (let i = 0; i < count; i++) {
    const color = colors[Math.floor(r() * colors.length)] ?? colors[0]
    const rx = minR + r() * (maxR - minR)
    s += `<ellipse cx="${round(r() * W)}" cy="${round(r() * H)}" rx="${round(rx)}" ry="${round(rx * (0.6 + r() * 0.4))}" fill="${color}" opacity="${opacity}"/>`
  }
  return s
}

function grass(): string {
  const r = rng(202)
  let s = `<rect width="${W}" height="${H}" fill="#4a7634"/>`
  s += speckles(r, 160, ['#3f6a2c', '#55833a', '#5d8c3e', '#456f30'], 40, 120, 0.55)
  s += speckles(r, 260, ['#3a6229', '#6a9a45'], 8, 22, 0.5)
  let blades = ''
  for (let i = 0; i < 2600; i++) {
    const x = r() * W
    const y = r() * H
    blades += `M${round(x)} ${round(y)}l${round(r() * 6 - 3)} ${round(-6 - r() * 8)}`
  }
  s += `<path d="${blades}" stroke="#2f5222" stroke-width="2" stroke-linecap="round" opacity=".55" fill="none"/>`
  let light = ''
  for (let i = 0; i < 1400; i++) {
    light += `M${round(r() * W)} ${round(r() * H)}l${round(r() * 6 - 3)} ${round(-5 - r() * 7)}`
  }
  s += `<path d="${light}" stroke="#86b85c" stroke-width="1.6" stroke-linecap="round" opacity=".5" fill="none"/>`
  return s
}

function dirt(): string {
  const r = rng(303)
  let s = `<rect width="${W}" height="${H}" fill="#7a5a3c"/>`
  s += speckles(r, 140, ['#6d4f33', '#866447', '#735437', '#8c6a4a'], 40, 130, 0.6)
  s += speckles(r, 900, ['#5e432b', '#93724f', '#6a4c31'], 2, 6, 0.7)
  for (let i = 0; i < 160; i++) {
    const cx = r() * W
    const cy = r() * H
    const rad = 3 + r() * 7
    const g = 120 + Math.round(r() * 40)
    s += `<path d="${polygonPath(blobPoints(r, cx, cy, rad, rad * 0.8, 6, 0.25))}" fill="rgb(${g},${g - 14},${g - 30})" stroke="#4a3622" stroke-width="1"/>`
  }
  return s
}

export const MAPS: readonly MapArt[] = [
  { slug: 'stone-floor', name: 'Stone floor', width: W, height: H, body: stoneFloor },
  { slug: 'grass', name: 'Grass', width: W, height: H, body: grass },
  { slug: 'dirt', name: 'Dirt', width: W, height: H, body: dirt },
]
