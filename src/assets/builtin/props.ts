import { blobPoints, polygonPath, rng, round } from './svg'

/**
 * Built-in props (SPEC §5.2): original top-down drawings, generated as SVG.
 * Each prop is drawn in a box of 100 units per grid cell; `cells` is its default
 * footprint when placed.
 */
export interface PropArt {
  slug: string
  name: string
  cells: { w: number; h: number }
  body: () => string
}

const OUTLINE = '#1d1a16'

function tree(): string {
  const r = rng(11)
  let s = `<ellipse cx="108" cy="110" rx="86" ry="84" fill="#000" opacity=".25"/>`
  const blobs: [number, number, number, string][] = [
    [100, 100, 74, '#2f6b34'],
    [72, 78, 40, '#3b8040'],
    [126, 74, 42, '#3b8040'],
    [70, 124, 40, '#367a3b'],
    [128, 126, 40, '#367a3b'],
    [100, 98, 42, '#4a9a48'],
  ]
  for (const [cx, cy, rad, fill] of blobs) {
    s += `<path d="${polygonPath(blobPoints(r, cx, cy, rad, rad, 14, 0.12))}" fill="${fill}" stroke="${OUTLINE}" stroke-width="2.5" stroke-linejoin="round"/>`
  }
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2
    const d = 10 + r() * 40
    s += `<circle cx="${round(100 + Math.cos(a) * d)}" cy="${round(98 + Math.sin(a) * d)}" r="${round(5 + r() * 6)}" fill="#6bb85e" opacity=".55"/>`
  }
  return s
}

function bush(): string {
  const r = rng(23)
  let s = `<ellipse cx="54" cy="55" rx="42" ry="40" fill="#000" opacity=".25"/>`
  for (const [cx, cy, rad] of [
    [38, 40, 22],
    [62, 38, 22],
    [36, 62, 22],
    [64, 62, 22],
    [50, 50, 24],
  ] as const) {
    s += `<path d="${polygonPath(blobPoints(r, cx, cy, rad, rad, 10, 0.14))}" fill="#4f9a3f" stroke="${OUTLINE}" stroke-width="2" stroke-linejoin="round"/>`
  }
  s += `<circle cx="44" cy="44" r="7" fill="#8bc66b" opacity=".6"/><circle cx="58" cy="56" r="5" fill="#8bc66b" opacity=".6"/>`
  return s
}

function rock(seed: number, size: number, cracks: number): string {
  const r = rng(seed)
  const c = size / 2
  const outer = blobPoints(r, c, c, c * 0.78, c * 0.7, 9, 0.18)
  let s = `<path d="${polygonPath(outer.map(([x, y]) => [x + size * 0.04, y + size * 0.05]))}" fill="#000" opacity=".3"/>`
  s += `<path d="${polygonPath(outer)}" fill="#858a91" stroke="${OUTLINE}" stroke-width="2.5" stroke-linejoin="round"/>`
  s += `<path d="${polygonPath(blobPoints(r, c * 0.85, c * 0.8, c * 0.45, c * 0.35, 7, 0.2))}" fill="#a4a9b0"/>`
  for (let i = 0; i < cracks; i++) {
    const x = c * (0.6 + r() * 0.8)
    const y = c * (0.6 + r() * 0.8)
    s += `<path d="M${round(x)} ${round(y)}l${round(r() * 18 - 9)} ${round(r() * 18 - 9)}l${round(r() * 14 - 7)} ${round(r() * 14 - 7)}" stroke="#4d5157" stroke-width="2" fill="none" stroke-linecap="round"/>`
  }
  return s
}

function crate(): string {
  return (
    `<rect x="12" y="12" width="82" height="82" fill="#000" opacity=".25"/>` +
    `<rect x="8" y="8" width="84" height="84" rx="3" fill="#9c6b3a" stroke="${OUTLINE}" stroke-width="3"/>` +
    `<rect x="17" y="17" width="66" height="66" fill="none" stroke="#6b4422" stroke-width="5"/>` +
    `<path d="M20 20 80 80M80 20 20 80" stroke="#6b4422" stroke-width="7" stroke-linecap="round"/>` +
    `<path d="M8 36h84M8 64h84" stroke="#7d5129" stroke-width="1.5" opacity=".5"/>`
  )
}

function barrel(): string {
  return (
    `<circle cx="53" cy="54" r="40" fill="#000" opacity=".25"/>` +
    `<circle cx="50" cy="50" r="40" fill="#8b5a2b" stroke="${OUTLINE}" stroke-width="3"/>` +
    `<circle cx="50" cy="50" r="34" fill="none" stroke="#5c5f63" stroke-width="4"/>` +
    `<circle cx="50" cy="50" r="24" fill="#a06a35" stroke="#6b4422" stroke-width="2"/>` +
    `<path d="M30 50h40M50 26v48" stroke="#6b4422" stroke-width="1.5" opacity=".7"/>` +
    `<circle cx="50" cy="50" r="3" fill="#3a2614"/>`
  )
}

function table(): string {
  return (
    `<rect x="14" y="16" width="180" height="76" rx="8" fill="#000" opacity=".25"/>` +
    `<rect x="8" y="10" width="184" height="80" rx="8" fill="#a0703d" stroke="${OUTLINE}" stroke-width="3"/>` +
    `<path d="M8 30h184M8 50h184M8 70h184" stroke="#7b5329" stroke-width="2"/>` +
    `<path d="M60 10v20M130 30v20M90 50v20M150 70v20M40 50v20" stroke="#7b5329" stroke-width="1.5"/>`
  )
}

function chest(): string {
  return (
    `<rect x="14" y="24" width="78" height="60" rx="4" fill="#000" opacity=".25"/>` +
    `<rect x="10" y="20" width="80" height="60" rx="5" fill="#8a5528" stroke="${OUTLINE}" stroke-width="3"/>` +
    `<path d="M10 42h80" stroke="#5e3a1b" stroke-width="3"/>` +
    `<path d="M24 20v60M76 20v60" stroke="#d4a93a" stroke-width="7"/>` +
    `<rect x="42" y="36" width="16" height="16" rx="2" fill="#d4a93a" stroke="${OUTLINE}" stroke-width="2"/>` +
    `<circle cx="50" cy="44" r="2.5" fill="${OUTLINE}"/>`
  )
}

function door(): string {
  return (
    `<rect x="4" y="40" width="94" height="24" fill="#000" opacity=".25"/>` +
    `<rect x="2" y="37" width="96" height="26" rx="2" fill="#9a6633" stroke="${OUTLINE}" stroke-width="3"/>` +
    `<path d="M26 37v26M50 37v26M74 37v26" stroke="#6b4422" stroke-width="2"/>` +
    `<rect x="8" y="33" width="8" height="34" rx="2" fill="#4a4d52" stroke="${OUTLINE}" stroke-width="1.5"/>` +
    `<circle cx="86" cy="50" r="3.5" fill="#d4a93a" stroke="${OUTLINE}" stroke-width="1"/>`
  )
}

function pillar(): string {
  return (
    `<circle cx="54" cy="55" r="40" fill="#000" opacity=".3"/>` +
    `<circle cx="50" cy="50" r="40" fill="#9aa0a8" stroke="${OUTLINE}" stroke-width="3"/>` +
    `<circle cx="50" cy="50" r="31" fill="#b4b9c0" stroke="#7a7f87" stroke-width="2"/>` +
    `<circle cx="50" cy="50" r="22" fill="none" stroke="#8c9198" stroke-width="1.5" stroke-dasharray="6 5"/>` +
    `<path d="M33 36a24 24 0 0 1 20-10" stroke="#e4e7eb" stroke-width="4" fill="none" stroke-linecap="round" opacity=".7"/>`
  )
}

function campfire(): string {
  const r = rng(37)
  let s = `<circle cx="50" cy="50" r="44" fill="#000" opacity=".2"/>`
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2
    const cx = 50 + Math.cos(a) * 36
    const cy = 50 + Math.sin(a) * 36
    s += `<path d="${polygonPath(blobPoints(r, cx, cy, 9, 8, 7, 0.2))}" fill="#7d8187" stroke="${OUTLINE}" stroke-width="2"/>`
  }
  s +=
    `<path d="M26 64 74 36M26 36l48 28" stroke="#5a3a1c" stroke-width="9" stroke-linecap="round"/>` +
    `<path d="M50 20c4 10 16 14 16 28 0 10-7 18-16 18s-16-8-16-18c0-8 5-12 8-17 1 5 3 7 5 8-1-7 0-13 3-19Z" fill="#e8762c"/>` +
    `<path d="M50 36c2 6 9 8 9 15 0 6-4 10-9 10s-9-4-9-10c0-4 3-7 5-9 0 3 2 4 3 5 0-4 0-7 1-11Z" fill="#f7c843"/>`
  return s
}

function water(): string {
  return (
    `<rect width="100" height="100" fill="#2f6fa3"/>` +
    `<path d="M0 18c12-7 25-7 37 0s25 7 37 0 18-5 26-2M0 52c12-7 25-7 37 0s25 7 37 0 18-5 26-2M0 86c12-7 25-7 37 0s25 7 37 0 18-5 26-2" stroke="#6aa5d4" stroke-width="3" fill="none" stroke-linecap="round" opacity=".8"/>` +
    `<path d="M14 35c8-4 16-4 24 0M58 69c8-4 16-4 24 0" stroke="#9cc8ea" stroke-width="2" fill="none" stroke-linecap="round" opacity=".6"/>`
  )
}

function wall(): string {
  const r = rng(53)
  let s = `<rect width="200" height="100" fill="#4b4f55"/>`
  for (let row = 0; row < 4; row++) {
    const y = row * 25
    let x = row % 2 === 0 ? 0 : -25
    while (x < 200) {
      const w = 40 + Math.round(r() * 20)
      const shade = 110 + Math.round(r() * 30)
      s += `<rect x="${x + 1.5}" y="${y + 1.5}" width="${w - 3}" height="22" rx="2" fill="rgb(${shade},${shade + 3},${shade + 8})"/>`
      x += w
    }
  }
  s += `<rect x="1.5" y="1.5" width="197" height="97" fill="none" stroke="${OUTLINE}" stroke-width="3"/>`
  return s
}

export const PROPS: readonly PropArt[] = [
  { slug: 'tree', name: 'Tree', cells: { w: 2, h: 2 }, body: tree },
  { slug: 'bush', name: 'Bush', cells: { w: 1, h: 1 }, body: bush },
  { slug: 'rock', name: 'Rock', cells: { w: 1, h: 1 }, body: () => rock(7, 100, 1) },
  { slug: 'boulder', name: 'Boulder', cells: { w: 2, h: 2 }, body: () => rock(19, 200, 3) },
  { slug: 'crate', name: 'Crate', cells: { w: 1, h: 1 }, body: crate },
  { slug: 'barrel', name: 'Barrel', cells: { w: 1, h: 1 }, body: barrel },
  { slug: 'table', name: 'Table', cells: { w: 2, h: 1 }, body: table },
  { slug: 'chest', name: 'Chest', cells: { w: 1, h: 1 }, body: chest },
  { slug: 'door', name: 'Door', cells: { w: 1, h: 1 }, body: door },
  { slug: 'pillar', name: 'Pillar', cells: { w: 1, h: 1 }, body: pillar },
  { slug: 'campfire', name: 'Campfire', cells: { w: 1, h: 1 }, body: campfire },
  { slug: 'water', name: 'Water tile', cells: { w: 1, h: 1 }, body: water },
  { slug: 'wall', name: 'Wall segment', cells: { w: 2, h: 1 }, body: wall },
]
