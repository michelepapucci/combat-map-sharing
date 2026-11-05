import { describe, expect, it } from 'vitest'
import { autoBadge, baseName, nextNumberedName } from './naming'

describe('auto-numbering', () => {
  it('numbers from 1 and continues after the highest number', () => {
    expect(nextNumberedName('Goblin', [])).toBe('Goblin 1')
    expect(nextNumberedName('Goblin', ['Goblin 1', 'Goblin 2'])).toBe('Goblin 3')
    expect(nextNumberedName('Goblin', ['Goblin 1', 'Goblin 7', 'Goblin 3'])).toBe('Goblin 8')
  })

  it('duplicating a numbered token uses its base name', () => {
    expect(baseName('Goblin 3')).toBe('Goblin')
    expect(nextNumberedName('Goblin 3', ['Goblin 1', 'Goblin 3'])).toBe('Goblin 4')
  })

  it('ignores other names and unnumbered matches', () => {
    expect(nextNumberedName('Goblin', ['Goblin', 'Goblin Boss 4', 'Hobgoblin 9'])).toBe('Goblin 1')
    expect(nextNumberedName('Goblin Boss', ['Goblin Boss 4'])).toBe('Goblin Boss 5')
  })

  it('ignores surrounding whitespace', () => {
    expect(nextNumberedName('  Orc  ', ['Orc 2 '])).toBe('Orc 3')
  })
})

describe('badges', () => {
  it('initials plus number, at most 3 characters', () => {
    expect(autoBadge('initials', 'Hero')).toBe('H')
    expect(autoBadge('initials', 'Goblin 12')).toBe('G12')
    expect(autoBadge('initials', 'Orc Captain 2')).toBe('OC2')
    expect(autoBadge('initials', 'Ancient Red Dragon')).toBe('ARD')
    expect(autoBadge('initials', 'Ancient Red Dragon 1')).toBe('AR1')
    expect(autoBadge('initials', 'Goblin 1234')).toBe('234')
    expect(autoBadge('initials', 'élan vital')).toBe('ÉV')
    expect(autoBadge('initials', '   ')).toBe('?')
  })

  it('number style shows only the trailing number', () => {
    expect(autoBadge('number', 'Wolf 3')).toBe('3')
    expect(autoBadge('number', 'Wolf')).toBeNull()
  })
})
