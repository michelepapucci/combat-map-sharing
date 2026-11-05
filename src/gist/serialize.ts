/**
 * The gist layout (SPEC §7 "Gist layout"), pure:
 * - `vtt-manifest.json`: app id, format, upload status, schema version, campaign
 *   id and name, updatedAt, and the uploaded assets with id/hash/bytes/mime/file;
 * - `campaign.json`: the CampaignState as JSON (explored fog is already compact
 *   base64 chunks, Decision 19);
 * - `asset-<id>.b64`: one base64 file per uploaded asset that is not local-only.
 *   Built-in assets are never uploaded.
 *
 * The manifest is the remote truth about assets: every asset it lists has its
 * file in the gist with exactly that content (sync.ts keeps it so at every commit).
 */
import { IMAGE_MIMES } from '../assets/upload/plan'
import type { AssetMeta, CampaignState } from '../state/types'
import { MAX_ID_LENGTH } from '../state/validate'
import type { GistSummary } from './api'

export const MANIFEST_FILE = 'vtt-manifest.json'
export const CAMPAIGN_FILE = 'campaign.json'
export const APP_ID = 'combat-map-sharing'
/** A gist lists at most 300 files (Decision 31); this leaves room for the manifest, the campaign and a few more. */
export const MAX_SYNCED_ASSETS = 290

const ASSET_FILE = /^asset-.+\.b64$/
const SHA256_HEX = /^[0-9a-f]{64}$/
/** Base64 alphabet with up to two padding characters at the end (the length is checked apart). */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
/** Bytes per btoa call: a multiple of 3, so the chunks need no padding between them. */
const BASE64_CHUNK = 3 * 8192

export function assetFileName(assetId: string): string {
  return `asset-${assetId}.b64`
}

/** Whether a gist file name is an asset file (`asset-<id>.b64`). */
export function isAssetFileName(name: string): boolean {
  return ASSET_FILE.test(name)
}

export interface ManifestAsset {
  id: string
  /** SHA-256 hex (lowercase) of the decoded bytes. */
  hash: string
  bytes: number
  mime: string
  /** Always assetFileName(id). */
  file: string
}

export interface Manifest {
  app: typeof APP_ID
  format: 1
  /** 'uploading' until the push that wrote it also wrote campaign.json. */
  status: 'complete' | 'uploading'
  schemaVersion: number
  campaignId: string
  name: string
  updatedAt: number
  assets: ManifestAsset[]
}

/** The gist content is not what this app writes. The message is user-facing. */
export class GistFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GistFormatError'
  }
}

export function gistDescription(name: string): string {
  return `VTT campaign: ${name}`
}

/** Library assets that sync: not localOnly. */
export function syncedAssets(campaign: CampaignState): AssetMeta[] {
  return campaign.library.filter((asset) => !asset.localOnly)
}

export function buildManifest(campaign: CampaignState, status: Manifest['status']): Manifest {
  return {
    app: APP_ID,
    format: 1,
    status,
    schemaVersion: campaign.version,
    campaignId: campaign.id,
    name: campaign.name,
    updatedAt: campaign.updatedAt,
    assets: syncedAssets(campaign).map((asset) => ({
      id: asset.id,
      hash: asset.hash,
      bytes: asset.bytes,
      mime: asset.mime,
      file: assetFileName(asset.id),
    })),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value !== '' &&
    value.length <= MAX_ID_LENGTH &&
    !(value in Object.prototype)
  )
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

const MIMES: readonly string[] = IMAGE_MIMES

function parseAsset(value: unknown, index: number): ManifestAsset {
  const where = `The gist manifest's asset ${index + 1}`
  if (!isRecord(value)) throw new GistFormatError(`${where} is not an object.`)
  const { id, hash, bytes, mime, file } = value
  if (!isId(id)) throw new GistFormatError(`${where} has no valid id.`)
  if (typeof hash !== 'string' || !SHA256_HEX.test(hash)) {
    throw new GistFormatError(`${where} has no valid SHA-256 hash.`)
  }
  if (!isCount(bytes)) throw new GistFormatError(`${where} has no valid size.`)
  if (typeof mime !== 'string' || !MIMES.includes(mime)) {
    throw new GistFormatError(`${where} has an unsupported image type.`)
  }
  if (file !== assetFileName(id)) {
    throw new GistFormatError(`${where} names the wrong file (expected ${assetFileName(id)}).`)
  }
  return { id, hash, bytes, mime, file: assetFileName(id) }
}

/**
 * Strict parse into a fresh object (unknown keys dropped). Throws GistFormatError
 * with a clear message for anything this app would not have written.
 */
export function parseManifest(text: string): Manifest {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new GistFormatError('The gist manifest is not valid JSON.')
  }
  if (!isRecord(data)) throw new GistFormatError('The gist manifest is not an object.')
  if (data.app !== APP_ID) throw new GistFormatError('This gist was not made by this app.')
  if (data.format !== 1) {
    throw new GistFormatError(
      typeof data.format === 'number' && data.format > 1
        ? 'This gist was saved by a newer version of the app. Reload the page to update it.'
        : 'The gist manifest has an unknown format.',
    )
  }
  const { status, schemaVersion, campaignId, name, updatedAt, assets } = data
  if (status !== 'complete' && status !== 'uploading') {
    throw new GistFormatError('The gist manifest has an unknown upload status.')
  }
  if (!isCount(schemaVersion) || schemaVersion < 1) {
    throw new GistFormatError('The gist manifest has no valid schema version.')
  }
  if (!isId(campaignId)) throw new GistFormatError('The gist manifest has no valid campaign id.')
  if (typeof name !== 'string') throw new GistFormatError('The gist manifest has no campaign name.')
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
    throw new GistFormatError('The gist manifest has no valid modification time.')
  }
  if (!Array.isArray(assets)) throw new GistFormatError('The gist manifest has no asset list.')
  const parsed = assets.map(parseAsset)
  const seen = new Set<string>()
  for (const asset of parsed) {
    if (seen.has(asset.id)) {
      throw new GistFormatError(`The gist manifest lists the asset "${asset.id}" twice.`)
    }
    seen.add(asset.id)
  }
  return {
    app: APP_ID,
    format: 1,
    status,
    schemaVersion,
    campaignId,
    name,
    updatedAt,
    assets: parsed,
  }
}

/** Standard base64 with padding. Chunked btoa: works in browsers and Node, no Buffer. */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  for (let start = 0; start < bytes.length; start += BASE64_CHUNK) {
    const chunk = bytes.subarray(start, start + BASE64_CHUNK)
    parts.push(btoa(String.fromCharCode(...chunk)))
  }
  return parts.join('')
}

/** Decodes standard padded base64; whitespace (such as a trailing newline) is ignored. */
export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.replace(/[\t\n\f\r ]+/g, '')
  if (clean.length % 4 !== 0 || !BASE64.test(clean))
    throw new GistFormatError('A gist file is not valid base64.')
  let binary: string
  try {
    binary = atob(clean)
  } catch {
    throw new GistFormatError('A gist file is not valid base64.')
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** A gist written by this app (it has the manifest file). */
export function isVttGist(summary: GistSummary): boolean {
  return summary.filenames.includes(MANIFEST_FILE)
}
