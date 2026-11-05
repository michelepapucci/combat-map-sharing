/**
 * Token auto-numbering (SPEC §5.3): placing or duplicating a token named "Goblin"
 * creates "Goblin 1", "Goblin 2", ... and badges derived from names.
 */

const NUMBERED = /^(.*\S)\s+(\d+)$/

/** "Goblin 3" -> "Goblin"; names without a trailing number are returned trimmed. */
export function baseName(name: string): string {
  const trimmed = name.trim()
  return NUMBERED.exec(trimmed)?.[1] ?? trimmed
}

/** The next free "<base> <n>", one above the highest number already used for that base. */
export function nextNumberedName(name: string, existingNames: Iterable<string>): string {
  const base = baseName(name)
  let highest = 0
  for (const existing of existingNames) {
    const match = NUMBERED.exec(existing.trim())
    if (match?.[1] === base) highest = Math.max(highest, Number(match[2]))
  }
  return `${base} ${highest + 1}`
}

/** How a token draws its badge: as the center text, or as a small number pip on a glyph or image. */
export type BadgeStyle = 'initials' | 'number'

/**
 * The badge a name implies (at most 3 characters):
 * - 'initials': word initials plus the trailing number: "Orc Captain 2" -> "OC2", "Hero" -> "H";
 * - 'number': just the trailing number ("Wolf 3" -> "3"), or null without one.
 */
export function autoBadge(style: BadgeStyle, name: string): string | null {
  const trimmed = name.trim()
  const match = NUMBERED.exec(trimmed)
  const number = match?.[2] ?? ''
  if (style === 'number') return number === '' ? null : number.slice(-3)
  if (number.length >= 3) return number.slice(-3)
  const words = (match?.[1] ?? trimmed).split(/\s+/).filter((w) => w !== '')
  const initials = words
    .map((w) => Array.from(w)[0]?.toUpperCase() ?? '')
    .slice(0, 3 - number.length)
  const badge = Array.from(initials.join('') + number)
    .slice(-3)
    .join('')
  return badge === '' ? '?' : badge
}
