import { crc32, deflateSync } from 'node:zlib'

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/**
 * A minimal PNG encoder for tests: an opaque RGB image filled by `pixel`, so
 * upload tests need no binary fixtures. Large flat images compress to a few KB.
 */
export function makePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number] = () => [200, 60, 40],
): Buffer {
  const row = 1 + width * 3
  const raw = Buffer.alloc(row * height)
  for (let y = 0; y < height; y++) {
    raw[y * row] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y)
      raw.writeUInt8(r, y * row + 1 + x * 3)
      raw.writeUInt8(g, y * row + 2 + x * 3)
      raw.writeUInt8(b, y * row + 3 + x * 3)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.writeUInt8(8, 8) // bit depth
  header.writeUInt8(2, 9) // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
