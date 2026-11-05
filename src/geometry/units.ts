import type { UnitSystem } from '../state/types'

/**
 * Lengths for display (Decision 65). Rule values are stored in feet, as 5e is
 * written; metric shows them at the convention of the metric rulebooks,
 * 5 ft = 1.5 m (1 ft = 0.3 m), so a 5 ft square is 1.5 m, 30 ft of movement is
 * 9 m and 60 ft of darkvision is 18 m.
 */
export const METERS_PER_FOOT = 0.3

export function unitSymbol(units: UnitSystem): 'm' | 'ft' {
  return units === 'metric' ? 'm' : 'ft'
}

/** Feet in the display unit: meters rounded to 0.1 m, or feet as they are. */
export function toDisplayLength(feet: number, units: UnitSystem): number {
  // feet * 3 / 10 instead of feet * 0.3 keeps whole feet exact (35 ft -> 10.5, not 10.499999).
  return units === 'metric' ? Math.round(feet * 3) / 10 : feet
}

/** A length typed in the display unit, back to feet. */
export function fromDisplayLength(value: number, units: UnitSystem): number {
  return units === 'metric' ? value / METERS_PER_FOOT : value
}

/** "9 m", "10.5 m", "30 ft" (feet rounded to whole feet). */
export function formatLength(feet: number, units: UnitSystem): string {
  return units === 'metric' ? `${toDisplayLength(feet, units)} m` : `${Math.round(feet)} ft`
}
