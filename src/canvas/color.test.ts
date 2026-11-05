import { describe, expect, it } from 'vitest'
import { parseHexColor, readableOn } from './color'

describe('token text color', () => {
  it('parses short and long hex colors', () => {
    expect(parseHexColor('#fff')).toStrictEqual([255, 255, 255])
    expect(parseHexColor('#3d7fd9')).toStrictEqual([61, 127, 217])
    expect(parseHexColor('red')).toBeNull()
  })

  it('picks the more readable of white and near-black', () => {
    expect(readableOn('#000000')).toBe('#ffffff')
    expect(readableOn('#d0463f')).toBe('#ffffff')
    expect(readableOn('#d8b62c')).toBe('#111111')
    expect(readableOn('#ffffff')).toBe('#111111')
    expect(readableOn('not a color')).toBe('#ffffff')
  })
})
