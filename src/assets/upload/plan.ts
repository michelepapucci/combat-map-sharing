/**
 * Pure rules of the upload pipeline (SPEC §5.2, §7; Decisions 30 and 31). An
 * upload is finalized at import: the stored blob is exactly what is rendered
 * and synced, so AssetMeta's mime/bytes/hash stay true on every machine.
 */
import type { AssetKind } from '../../state/types'

export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type ImageMime = (typeof IMAGE_MIMES)[number]

/** Images larger than this on the long side are downscaled (SPEC §5.2). */
export const MAX_IMAGE_EDGE = 8192
/** Largest asset that can sync to a gist: base64 must stay under 10 MB (Decision 31). */
export const SYNC_MAX_BYTES = 7_000_000
/** Files above this are refused before decoding (a decoded 8k image already needs 256 MB). */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
/** Library thumbnails, long side in px. */
export const THUMBNAIL_EDGE = 256

/** Encoder qualities tried in order until the result fits SYNC_MAX_BYTES. */
export const WEBP_QUALITIES = [0.92, 0.85, 0.75, 0.6] as const
export const JPEG_QUALITIES = [0.9, 0.8, 0.7] as const

/** Detects PNG, JPEG and WebP from the first 12 bytes; anything else is null. */
export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  const at = (i: number) => bytes[i] ?? -1
  const ascii = (from: number, text: string) =>
    Array.from(text).every((char, i) => at(from + i) === char.charCodeAt(0))
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b)) {
    return 'image/png'
  }
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp'
  return null
}

/** Scales (width, height) down to fit `maxEdge` on the long side; never scales up. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Default prop footprint: one cell on the short side, the aspect ratio on the long side. */
export function defaultCellsFor(width: number, height: number): { w: number; h: number } {
  const ratio = Math.max(width, height) / Math.min(width, height)
  const long = Math.min(10, Math.max(1, Math.round(ratio)))
  return width >= height ? { w: long, h: 1 } : { w: 1, h: long }
}

/** Asset name from a file name: no extension, separators as spaces, trimmed. */
export function nameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ')
  const name = base.replace(/\s+/g, ' ').trim()
  return name.slice(0, 200) || 'Image'
}

export type Encoder = (type: ImageMime, quality?: number) => Promise<Blob>

export interface EncodingChoice {
  /** The re-encoded image, or null to keep the original file. */
  blob: Blob | null
  /** Too large for gist sync even after compression: stays on this device. */
  localOnly: boolean
}

/**
 * Chooses how to store an image that needs re-encoding (`mustEncode`: it was
 * downscaled) or may need it (the original is over SYNC_MAX_BYTES).
 * Tries WebP at decreasing quality and takes the first result that fits. If the
 * browser cannot encode WebP (it silently returns PNG), maps fall back to JPEG
 * and other kinds (which may be transparent) to PNG. If nothing fits, the asset
 * becomes local-only, keeping the original when it was not downscaled, or the
 * highest-quality encoding otherwise.
 */
export async function chooseEncoding(
  {
    originalBytes,
    mustEncode,
    kind,
  }: { originalBytes: number; mustEncode: boolean; kind: AssetKind },
  encode: Encoder,
): Promise<EncodingChoice> {
  if (!mustEncode && originalBytes <= SYNC_MAX_BYTES) return { blob: null, localOnly: false }
  const tried: { first: Blob | null } = { first: null }
  /** The first encoding of `type` that fits, null if none does, 'unsupported' if the browser can't encode it. */
  const attempt = async (
    type: ImageMime,
    qualities: readonly (number | undefined)[],
  ): Promise<Blob | null | 'unsupported'> => {
    for (const quality of qualities) {
      const blob = await encode(type, quality)
      if (blob.type !== type) return 'unsupported'
      tried.first ??= blob
      if (blob.size <= SYNC_MAX_BYTES) return blob
    }
    return null
  }
  let fitting = await attempt('image/webp', WEBP_QUALITIES)
  if (fitting === 'unsupported') {
    fitting =
      kind === 'map'
        ? await attempt('image/jpeg', JPEG_QUALITIES)
        : await attempt('image/png', [undefined])
  }
  if (fitting instanceof Blob) return { blob: fitting, localOnly: false }
  if (!mustEncode) return { blob: null, localOnly: true }
  if (tried.first) return { blob: tried.first, localOnly: true }
  const png = await encode('image/png')
  return { blob: png, localOnly: png.size > SYNC_MAX_BYTES }
}

/** Lowercase hex of a digest. */
export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('')
}
