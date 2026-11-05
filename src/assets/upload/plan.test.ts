import { describe, expect, it } from 'vitest'
import {
  chooseEncoding,
  defaultCellsFor,
  fitWithin,
  nameFromFile,
  sniffImageMime,
  SYNC_MAX_BYTES,
  toHex,
  type Encoder,
  type ImageMime,
} from './plan'

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(
    values.flatMap((v) => (typeof v === 'string' ? Array.from(v, (c) => c.charCodeAt(0)) : [v])),
  )

describe('sniffImageMime', () => {
  it('recognizes PNG, JPEG and WebP by their magic bytes', () => {
    expect(sniffImageMime(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13))).toBe(
      'image/png',
    )
    expect(sniffImageMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(sniffImageMime(bytes('RIFF', 1, 2, 3, 4, 'WEBP'))).toBe('image/webp')
  })

  it('rejects everything else, including short input', () => {
    expect(sniffImageMime(bytes('GIF89a'))).toBeNull()
    expect(sniffImageMime(bytes('<svg xmlns'))).toBeNull()
    expect(sniffImageMime(bytes('RIFF', 1, 2, 3, 4, 'WAVE'))).toBeNull()
    expect(sniffImageMime(bytes(0xff, 0xd8))).toBeNull()
    expect(sniffImageMime(new Uint8Array())).toBeNull()
  })
})

describe('sizes and names', () => {
  it('fits the long side, never upscaling', () => {
    expect(fitWithin(12000, 9000, 8192)).toStrictEqual({ width: 8192, height: 6144 })
    expect(fitWithin(300, 9000, 8192)).toStrictEqual({ width: 273, height: 8192 })
    expect(fitWithin(800, 600, 8192)).toStrictEqual({ width: 800, height: 600 })
    expect(fitWithin(100000, 1, 256)).toStrictEqual({ width: 256, height: 1 })
  })

  it('gives props one cell on the short side', () => {
    expect(defaultCellsFor(256, 256)).toStrictEqual({ w: 1, h: 1 })
    expect(defaultCellsFor(600, 290)).toStrictEqual({ w: 2, h: 1 })
    expect(defaultCellsFor(100, 330)).toStrictEqual({ w: 1, h: 3 })
    expect(defaultCellsFor(5000, 10)).toStrictEqual({ w: 10, h: 1 })
  })

  it('names assets after the file', () => {
    expect(nameFromFile('goblin_chief-token.png')).toBe('goblin chief token')
    expect(nameFromFile('Old Mill.Map.webp')).toBe('Old Mill.Map')
    expect(nameFromFile('.png')).toBe('Image')
  })

  it('formats digests as hex', () => {
    expect(toHex(new Uint8Array([0, 15, 255]).buffer)).toBe('000fff')
  })
})

/** A fake encoder: sizes per (type, quality); unsupported types come back as PNG. */
function encoder(sizes: Record<string, number>, unsupported: ImageMime[] = []) {
  const calls: string[] = []
  const encode: Encoder = async (type, quality) => {
    const key = `${type}@${quality ?? ''}`
    calls.push(key)
    const actual = unsupported.includes(type) ? 'image/png' : type
    const size = sizes[unsupported.includes(type) ? 'image/png@' : key] ?? 1
    return new Blob([new Uint8Array(size)], { type: actual })
  }
  return { encode, calls }
}

describe('chooseEncoding', () => {
  const big = SYNC_MAX_BYTES + 1

  it('keeps small originals untouched', async () => {
    const { encode, calls } = encoder({})
    expect(
      await chooseEncoding({ originalBytes: 1000, mustEncode: false, kind: 'map' }, encode),
    ).toStrictEqual({ blob: null, localOnly: false })
    expect(calls).toStrictEqual([])
  })

  it('re-encodes large originals as WebP at the best quality that fits', async () => {
    const { encode, calls } = encoder({ 'image/webp@0.92': big, 'image/webp@0.85': 5_000_000 })
    const choice = await chooseEncoding(
      { originalBytes: big, mustEncode: false, kind: 'map' },
      encode,
    )
    expect(choice.localOnly).toBe(false)
    expect(choice.blob?.size).toBe(5_000_000)
    expect(choice.blob?.type).toBe('image/webp')
    expect(calls).toStrictEqual(['image/webp@0.92', 'image/webp@0.85'])
  })

  it('downscaled images are always encoded', async () => {
    const { encode } = encoder({ 'image/webp@0.92': 4_000_000 })
    const choice = await chooseEncoding(
      { originalBytes: 100, mustEncode: true, kind: 'prop' },
      encode,
    )
    expect(choice).toMatchObject({ localOnly: false })
    expect(choice.blob?.size).toBe(4_000_000)
  })

  it('keeps an original that nothing can shrink enough, as local-only', async () => {
    const { encode } = encoder({
      'image/webp@0.92': big,
      'image/webp@0.85': big,
      'image/webp@0.75': big,
      'image/webp@0.6': big,
    })
    expect(
      await chooseEncoding({ originalBytes: big, mustEncode: false, kind: 'map' }, encode),
    ).toStrictEqual({ blob: null, localOnly: true })
  })

  it('a downscaled image that never fits keeps the best-quality encoding, local-only', async () => {
    const { encode } = encoder({
      'image/webp@0.92': big + 3,
      'image/webp@0.85': big + 2,
      'image/webp@0.75': big + 1,
      'image/webp@0.6': big,
    })
    const choice = await chooseEncoding(
      { originalBytes: 10, mustEncode: true, kind: 'map' },
      encode,
    )
    expect(choice.localOnly).toBe(true)
    expect(choice.blob?.size).toBe(big + 3)
  })

  it('without a WebP encoder, maps fall back to JPEG and other kinds to PNG', async () => {
    const maps = encoder({ 'image/png@': big, 'image/jpeg@0.9': 3_000_000 }, ['image/webp'])
    const map = await chooseEncoding(
      { originalBytes: big, mustEncode: true, kind: 'map' },
      maps.encode,
    )
    expect(map.blob?.type).toBe('image/jpeg')
    expect(maps.calls).toStrictEqual(['image/webp@0.92', 'image/jpeg@0.9'])

    const props = encoder({ 'image/png@': 2_000_000 }, ['image/webp'])
    const prop = await chooseEncoding(
      { originalBytes: 10, mustEncode: true, kind: 'prop' },
      props.encode,
    )
    expect(prop).toMatchObject({ localOnly: false })
    expect(prop.blob?.type).toBe('image/png')
    expect(props.calls).toStrictEqual(['image/webp@0.92', 'image/png@'])
  })
})
