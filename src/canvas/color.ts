/** Parses #rgb / #rrggbb; anything else returns null. */
export function parseHexColor(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1]
  if (!hex) return null
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

function channel(v: number): number {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of an sRGB color, 0..1. */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Near-black or white, whichever contrasts more with the background color. */
export function readableOn(background: string): string {
  const rgb = parseHexColor(background)
  if (!rgb) return '#ffffff'
  const l = relativeLuminance(rgb)
  // Contrast with white is 1.05 / (l + 0.05); with #111 (l ~ 0.0056) it is (l + 0.05) / 0.0556.
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.0556 ? '#ffffff' : '#111111'
}

/** Health bar color by remaining fraction: green above half, amber above a quarter, red. */
export function hpColor(fraction: number): string {
  if (fraction > 0.5) return '#3fbf5f'
  if (fraction > 0.25) return '#e0b52c'
  return '#e04a3f'
}
