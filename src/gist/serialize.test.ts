import { describe, expect, it } from 'vitest'
import { sampleCampaign } from '../state/fixtures/sampleCampaign'
import {
  APP_ID,
  assetFileName,
  base64ToBytes,
  buildManifest,
  bytesToBase64,
  gistDescription,
  GistFormatError,
  isAssetFileName,
  isVttGist,
  MANIFEST_FILE,
  parseManifest,
  syncedAssets,
  type Manifest,
} from './serialize'

const HASH = 'a'.repeat(64)

function manifest(): Manifest {
  return buildManifest(structuredClone(sampleCampaign), 'complete')
}

type Mutation = (m: Record<string, unknown>, asset: Record<string, unknown>) => void

function asset0(m: Record<string, unknown>): Record<string, unknown> {
  const assets = m.assets
  if (!Array.isArray(assets) || typeof assets[0] !== 'object') throw new Error('no asset')
  return assets[0] as Record<string, unknown>
}

describe('manifest', () => {
  it('lists the synced (not local-only) assets in library order', () => {
    const campaign = structuredClone(sampleCampaign)
    expect(syncedAssets(campaign).map((a) => a.id)).toStrictEqual(['asset-map-1', 'asset-token-1'])
    expect(buildManifest(campaign, 'uploading')).toStrictEqual({
      app: APP_ID,
      format: 1,
      status: 'uploading',
      schemaVersion: campaign.version,
      campaignId: 'campaign-1',
      name: 'Test Campaign',
      updatedAt: campaign.updatedAt,
      assets: [
        {
          id: 'asset-map-1',
          hash: campaign.library[0]?.hash,
          bytes: 1843200,
          mime: 'image/webp',
          file: 'asset-asset-map-1.b64',
        },
        {
          id: 'asset-token-1',
          hash: campaign.library[1]?.hash,
          bytes: 204800,
          mime: 'image/png',
          file: 'asset-asset-token-1.b64',
        },
      ],
    })
  })

  it('round-trips through parseManifest', () => {
    const built = manifest()
    expect(parseManifest(JSON.stringify(built))).toStrictEqual(built)
    expect(parseManifest(JSON.stringify(built, null, 2))).toStrictEqual(built)
    const uploading = { ...built, status: 'uploading' as const, assets: [] }
    expect(parseManifest(JSON.stringify(uploading))).toStrictEqual(uploading)
  })

  it('drops unknown keys', () => {
    const built = manifest()
    const extra = {
      ...built,
      secret: 1,
      assets: built.assets.map((a) => ({ ...a, note: 'x' })),
    }
    expect(parseManifest(JSON.stringify(extra))).toStrictEqual(built)
  })

  const cases: [string, Mutation, RegExp][] = [
    ['another app', (m) => (m.app = 'other-app'), /not made by this app/],
    ['no app', (m) => delete m.app, /not made by this app/],
    ['a newer format', (m) => (m.format = 2), /newer version of the app/],
    ['an unknown format', (m) => (m.format = '1'), /unknown format/],
    ['a bad status', (m) => (m.status = 'done'), /upload status/],
    ['schema version 0', (m) => (m.schemaVersion = 0), /schema version/],
    ['a fractional schema version', (m) => (m.schemaVersion = 1.5), /schema version/],
    ['a string schema version', (m) => (m.schemaVersion = '2'), /schema version/],
    ['an empty campaign id', (m) => (m.campaignId = ''), /campaign id/],
    ['a reserved campaign id', (m) => (m.campaignId = '__proto__'), /campaign id/],
    ['a long campaign id', (m) => (m.campaignId = 'c'.repeat(129)), /campaign id/],
    ['a missing name', (m) => delete m.name, /campaign name/],
    ['a numeric name', (m) => (m.name = 3), /campaign name/],
    ['a string updatedAt', (m) => (m.updatedAt = '2026'), /modification time/],
    ['a null updatedAt', (m) => (m.updatedAt = null), /modification time/],
    ['no asset list', (m) => (m.assets = { 0: 1 }), /asset list/],
    ['an asset that is not an object', (m) => (m.assets = [null]), /asset 1 is not an object/],
    ['an asset without id', (_, a) => delete a.id, /asset 1 has no valid id/],
    ['an asset with an empty id', (_, a) => (a.id = ''), /asset 1 has no valid id/],
    ['an asset with a reserved id', (_, a) => (a.id = 'constructor'), /no valid id/],
    ['a short hash', (_, a) => (a.hash = 'a'.repeat(63)), /SHA-256/],
    ['a long hash', (_, a) => (a.hash = 'a'.repeat(65)), /SHA-256/],
    ['an upper-case hash', (_, a) => (a.hash = 'A'.repeat(64)), /SHA-256/],
    ['a non-hex hash', (_, a) => (a.hash = 'g'.repeat(64)), /SHA-256/],
    ['negative bytes', (_, a) => (a.bytes = -1), /valid size/],
    ['fractional bytes', (_, a) => (a.bytes = 1.5), /valid size/],
    ['string bytes', (_, a) => (a.bytes = '3'), /valid size/],
    ['an unsupported mime', (_, a) => (a.mime = 'image/svg+xml'), /unsupported image type/],
    ['a wrong file name', (_, a) => (a.file = 'asset-other.b64'), /wrong file/],
    ['a path as file name', (_, a) => (a.file = '../asset-asset-map-1.b64'), /wrong file/],
    ['no file name', (_, a) => delete a.file, /wrong file/],
    [
      'a duplicate id',
      (m) => {
        const assets = m.assets
        if (Array.isArray(assets)) assets.push({ ...asset0(m) })
      },
      /lists the asset "asset-map-1" twice/,
    ],
  ]
  it.each(cases)('rejects %s', (_, mutate, message) => {
    const data = JSON.parse(JSON.stringify(manifest())) as Record<string, unknown>
    mutate(data, asset0(data))
    expect(() => parseManifest(JSON.stringify(data))).toThrow(GistFormatError)
    expect(() => parseManifest(JSON.stringify(data))).toThrow(message)
  })

  it.each([
    ['', /not valid JSON/],
    ['{', /not valid JSON/],
    ['[]', /not an object/],
    ['null', /not an object/],
    ['"manifest"', /not an object/],
  ])('rejects the text %j', (text, message) => {
    expect(() => parseManifest(text)).toThrow(GistFormatError)
    expect(() => parseManifest(text)).toThrow(message)
  })

  it('accepts zero-byte sizes and any valid hash', () => {
    const data = manifest()
    const first = data.assets[0]
    if (!first) throw new Error('no asset')
    const edited = { ...data, assets: [{ ...first, bytes: 0, hash: HASH }] }
    expect(parseManifest(JSON.stringify(edited)).assets[0]).toStrictEqual({
      ...first,
      bytes: 0,
      hash: HASH,
    })
  })
})

describe('names', () => {
  it('builds file names and descriptions', () => {
    expect(assetFileName('9b1d')).toBe('asset-9b1d.b64')
    expect(isAssetFileName('asset-9b1d.b64')).toBe(true)
    expect(isAssetFileName('asset-.b64')).toBe(false)
    expect(isAssetFileName('campaign.json')).toBe(false)
    expect(isAssetFileName('asset-x.b64.txt')).toBe(false)
    expect(gistDescription('Curse of Strahd')).toBe('VTT campaign: Curse of Strahd')
  })

  it('recognizes VTT gists by their manifest', () => {
    const summary = { id: 'a', description: '', htmlUrl: '', updatedAt: '' }
    expect(isVttGist({ ...summary, filenames: ['campaign.json', MANIFEST_FILE] })).toBe(true)
    expect(isVttGist({ ...summary, filenames: ['campaign.json'] })).toBe(false)
    expect(isVttGist({ ...summary, filenames: [] })).toBe(false)
  })
})

/** Straightforward base64 encoder (RFC 4648), as an independent reference. */
function referenceBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += alphabet[(n >> 18) & 63] ?? ''
    out += alphabet[(n >> 12) & 63] ?? ''
    out += i + 1 < bytes.length ? (alphabet[(n >> 6) & 63] ?? '') : '='
    out += i + 2 < bytes.length ? (alphabet[n & 63] ?? '') : '='
  }
  return out
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length)
  // getRandomValues fills at most 65536 bytes per call.
  for (let start = 0; start < length; start += 65536) {
    crypto.getRandomValues(bytes.subarray(start, start + 65536))
  }
  return bytes
}

describe('base64', () => {
  it.each([
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ])('encodes %j as %j (RFC 4648 vectors)', (plain, encoded) => {
    const bytes = new TextEncoder().encode(plain)
    expect(bytesToBase64(bytes)).toBe(encoded)
    expect(base64ToBytes(encoded)).toStrictEqual(bytes)
  })

  it('round-trips every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)
    const encoded = bytesToBase64(bytes)
    expect(encoded).toBe(referenceBase64(bytes))
    expect(base64ToBytes(encoded)).toStrictEqual(bytes)
  })

  it('round-trips 1 MB of random bytes across chunk boundaries', () => {
    for (const length of [1024 * 1024, 3 * 8192, 3 * 8192 + 1, 3 * 8192 - 1, 100_001]) {
      const bytes = randomBytes(length)
      const encoded = bytesToBase64(bytes)
      expect(encoded.length).toBe(4 * Math.ceil(length / 3))
      expect(encoded).toBe(referenceBase64(bytes))
      expect(base64ToBytes(encoded)).toStrictEqual(bytes)
    }
  })

  it('encodes a view into a larger buffer, not the whole buffer', () => {
    const buffer = Uint8Array.from([1, 2, 3, 4, 5, 6])
    expect(bytesToBase64(buffer.subarray(2, 5))).toBe(bytesToBase64(Uint8Array.from([3, 4, 5])))
  })

  it('tolerates whitespace such as a trailing newline', () => {
    const expected = new TextEncoder().encode('foobar')
    expect(base64ToBytes('Zm9vYmFy\n')).toStrictEqual(expected)
    expect(base64ToBytes(' Zm9v\r\nYmFy \t')).toStrictEqual(expected)
  })

  it.each(['Zm9', 'Zm9vY', '@@@@', 'Zm9v!mFy', 'Zg=a', 'Z===', '====', 'Zg==Zg==', 'Zm-_', 'é'])(
    'rejects %j',
    (text) => {
      expect(() => base64ToBytes(text)).toThrow(GistFormatError)
    },
  )
})
