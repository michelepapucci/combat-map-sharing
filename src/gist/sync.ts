/**
 * Pushing a campaign to its gist and pulling it back (SPEC §7 "Sync behavior";
 * CLAUDE.md "Gist (M8)"). Storage and hashing are injected (SyncDeps), so this
 * module never touches IndexedDB, the stores or the UI.
 *
 * Remote invariant, kept at every commit a push makes: each asset listed in
 * the manifest has its `asset-<id>.b64` file in the gist with exactly that
 * hash. Asset batches therefore rewrite the manifest's asset list in the same
 * PATCH as the files they upload, so an interrupted push leaves a consistent
 * gist, and the next push only uploads what is still missing.
 *
 * Conflicts compare commit SHAs (Decision 32): a push stops with ConflictError
 * when the gist's latest commit is not the one this device last synced, and
 * checks again before each later commit, since uploading images takes a while.
 */
import { SYNC_MAX_BYTES } from '../assets/upload/plan'
import type { AssetMeta, CampaignState } from '../state/types'
import { GitHubError, type GistApi, type GistData, type GistFile } from './api'
import {
  assetFileName,
  base64ToBytes,
  buildManifest,
  bytesToBase64,
  CAMPAIGN_FILE,
  gistDescription,
  GistFormatError,
  isAssetFileName,
  MANIFEST_FILE,
  MAX_SYNCED_ASSETS,
  parseManifest,
  syncedAssets,
  type Manifest,
  type ManifestAsset,
} from './serialize'

/** Base64 characters per asset PATCH (the manifest rides along). A larger single file goes alone. */
export const DEFAULT_BYTE_BUDGET = 12_000_000

export interface SyncDeps {
  api: GistApi
  /** The stored blob of an uploaded asset, or null if this device does not have it. */
  readAsset(id: string): Promise<Blob | null>
  /** Whether this device already has the asset with exactly this content hash. */
  hasAsset(id: string, hash: string): Promise<boolean>
  /** Stores a downloaded asset blob (the caller adds thumbnails). */
  writeAsset(meta: { id: string; mime: string; hash: string }, blob: Blob): Promise<void>
  sha256Hex(bytes: Uint8Array): Promise<string>
}

export interface SyncLink {
  gistId: string | null
  lastSyncedSha: string | null
}

export class ConflictError extends Error {
  /** The gist's latest commit, which this device has not seen. */
  readonly remoteSha: string | null

  constructor(remoteSha: string | null) {
    super('The gist changed since this device last synced it')
    this.name = 'ConflictError'
    this.remoteSha = remoteSha
  }
}

/** A sync problem with a user-facing message (too many images, gist truncated, unfinished upload...). */
export class SyncError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncError'
  }
}

export interface PushProgress {
  phase: 'checking' | 'assets' | 'campaign'
  done: number
  total: number
}

export interface PushOptions {
  /** Overwrite the gist even if it changed elsewhere (the DM chose "Overwrite"). */
  force?: boolean
  onProgress?: (progress: PushProgress) => void
  /** Base64 characters per asset PATCH (default DEFAULT_BYTE_BUDGET). */
  byteBudget?: number
  /**
   * Called after each commit this push makes (gist creation, every asset batch,
   * the final commit). Storing the link here lets a push interrupted after
   * creating the gist resume in that gist instead of creating another one.
   */
  onCommit?: (link: { gistId: string; lastSyncedSha: string }) => void
}

export interface PushResult {
  gistId: string
  sha: string | null
  uploadedAssets: number
  deletedAssets: number
  /**
   * Library assets not in the gist, in library order: local-only ones, and those
   * whose blob is missing on this device, does not match its hash, or is over
   * SYNC_MAX_BYTES.
   */
  skippedAssets: AssetMeta[]
}

export interface PullOptions {
  /** Load the gist as it was at this commit SHA (history). */
  revision?: string
  /** Asset downloads: `done` of `total` manifest assets handled. */
  onProgress?: (progress: { done: number; total: number }) => void
}

export interface PullResult {
  /** Parsed campaign.json, NOT validated: the caller migrates and validates it. */
  campaign: unknown
  manifest: Manifest
  sha: string | null
  downloadedAssets: number
  /** Ids of manifest assets that could not be fetched or failed the hash check. */
  missingAssets: string[]
}

const TOO_MANY_FILES =
  'This gist has more files than GitHub lists (300), so it cannot be synced. Remove files from it on GitHub, or save to a new gist.'
const NOT_VTT_GIST = 'Not a VTT campaign gist'
const UPLOAD_UNFINISHED =
  "This gist's upload never finished: push again from the device that has the campaign"

function tooManyAssets(count: number): string {
  return `Too many images to sync: ${count} (at most ${MAX_SYNCED_ASSETS}). Delete unused images or keep some local-only.`
}

function getFile(files: Record<string, GistFile>, name: string): GistFile | null {
  return Object.hasOwn(files, name) ? (files[name] ?? null) : null
}

/** A file's full text: inline content, or its raw URL when GitHub truncated it. */
async function readFile(api: GistApi, file: GistFile): Promise<string> {
  if (!file.truncated && file.content !== null) return file.content
  if (file.rawUrl === '') {
    throw new SyncError(`GitHub did not return the gist file ${file.filename}.`)
  }
  return api.fetchRaw(file.rawUrl)
}

function manifestJson(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/** What the gist holds before this push writes to it. */
interface Remote {
  gistId: string
  /** Its latest commit, when known. */
  sha: string | null
  files: Record<string, GistFile>
  /** Null when a forced push overwrites a gist without a readable manifest. */
  manifest: Manifest | null
  created: boolean
}

async function createRemote(api: GistApi, campaign: CampaignState): Promise<Remote> {
  const manifest: Manifest = { ...buildManifest(campaign, 'uploading'), assets: [] }
  const gist = await api.createGist(gistDescription(campaign.name), {
    [MANIFEST_FILE]: manifestJson(manifest),
  })
  return { gistId: gist.id, sha: gist.latestSha, files: gist.files, manifest, created: true }
}

async function readRemote(
  api: GistApi,
  gistId: string,
  lastSyncedSha: string | null,
  force: boolean,
): Promise<Remote> {
  const latest = await api.latestCommitSha(gistId)
  if (!force && latest !== lastSyncedSha) throw new ConflictError(latest)
  const gist = await api.getGist(gistId)
  if (gist.truncated) throw new SyncError(TOO_MANY_FILES)
  // A commit landed between the two requests.
  if (!force && gist.latestSha !== null && gist.latestSha !== latest) {
    throw new ConflictError(gist.latestSha)
  }
  let manifest: Manifest | null = null
  try {
    const file = getFile(gist.files, MANIFEST_FILE)
    if (file === null) throw new GistFormatError(NOT_VTT_GIST)
    manifest = parseManifest(await readFile(api, file))
  } catch (error) {
    if (!(error instanceof GistFormatError)) throw error
    // Overwriting anyway: treat the gist as having no assets.
    if (!force) throw new SyncError(error.message)
  }
  return { gistId, sha: gist.latestSha ?? latest, files: gist.files, manifest, created: false }
}

interface Encoded {
  entry: ManifestAsset
  content: string
}

/**
 * Saves the campaign to its gist, creating a secret gist when `link.gistId` is
 * null. Uploads only assets the remote manifest lacks (by hash), in PATCHes
 * under the byte budget, then the manifest and campaign.json together, deleting
 * remote asset files nothing references any more.
 */
export async function pushCampaign(
  deps: SyncDeps,
  campaign: CampaignState,
  link: SyncLink,
  options: PushOptions = {},
): Promise<PushResult> {
  const { api } = deps
  const force = options.force === true
  const budget = options.byteBudget ?? DEFAULT_BYTE_BUDGET
  const report = (phase: PushProgress['phase'], done: number, total: number): void => {
    options.onProgress?.({ phase, done, total })
  }
  const committed = (gistId: string, sha: string | null): void => {
    if (sha !== null) options.onCommit?.({ gistId, lastSyncedSha: sha })
  }

  const synced = syncedAssets(campaign)
  if (synced.length > MAX_SYNCED_ASSETS) throw new SyncError(tooManyAssets(synced.length))

  report('checking', 0, 1)
  const remote =
    link.gistId === null
      ? await createRemote(api, campaign)
      : await readRemote(api, link.gistId, link.lastSyncedSha, force)
  const { gistId } = remote
  if (remote.created) committed(gistId, remote.sha)
  report('checking', 1, 1)

  // Assets the gist holds now: listed in its manifest, with their file present.
  const present = new Map<string, ManifestAsset>()
  for (const entry of remote.manifest?.assets ?? []) {
    if (getFile(remote.files, entry.file) !== null) present.set(entry.id, entry)
  }
  // Batches keep the remote manifest's campaign fields (its campaign.json is unchanged until the end).
  const interim: Manifest = remote.manifest ?? {
    ...buildManifest(campaign, 'uploading'),
    assets: [],
  }

  const pending = synced.filter((asset) => present.get(asset.id)?.hash !== asset.hash)
  const skipped: AssetMeta[] = []
  let batch: Encoded[] = []
  let batchChars = 0
  let handled = 0
  let uploaded = 0
  let batches = 0
  let expectedSha = remote.sha

  // Reading and uploading images takes a while: before each commit after the
  // first check, make sure nobody else pushed meanwhile. (A new gist's id is
  // known only here; a forced push overwrites anyway.)
  const ensureUnchanged = async (): Promise<void> => {
    if (force || remote.created || expectedSha === null) return
    const latest = await api.latestCommitSha(gistId)
    if (latest !== expectedSha) throw new ConflictError(latest)
  }

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return
    await ensureUnchanged()
    const assets = new Map(present)
    for (const item of batch) assets.set(item.entry.id, item.entry)
    const files: Record<string, string> = Object.fromEntries(
      batch.map((item) => [item.entry.file, item.content]),
    )
    files[MANIFEST_FILE] = manifestJson({ ...interim, assets: [...assets.values()] })
    const result = await api.updateGist(gistId, files)
    for (const item of batch) present.set(item.entry.id, item.entry)
    uploaded += batch.length
    handled += batch.length
    batches++
    expectedSha = result.latestSha
    committed(gistId, result.latestSha)
    batch = []
    batchChars = 0
    report('assets', handled, pending.length)
  }

  report('assets', 0, pending.length)
  // One blob at a time, so memory holds at most one batch.
  for (const asset of pending) {
    const content = await encodeAsset(deps, asset)
    if (content === null) {
      skipped.push(asset)
      handled++
      report('assets', handled, pending.length)
      continue
    }
    if (batch.length > 0 && batchChars + content.length > budget) {
      await flush()
    }
    const entry: ManifestAsset = {
      id: asset.id,
      hash: asset.hash,
      bytes: asset.bytes,
      mime: asset.mime,
      file: assetFileName(asset.id),
    }
    batch.push({ entry, content })
    batchChars += content.length
  }
  await flush()

  if (batches > 0) await ensureUnchanged()

  report('campaign', 0, 1)
  const skippedIds = new Set(skipped.map((asset) => asset.id))
  const complete = buildManifest(campaign, 'complete')
  const manifest: Manifest = {
    ...complete,
    assets: complete.assets.filter((entry) => !skippedIds.has(entry.id)),
  }
  const referenced = new Set(manifest.assets.map((entry) => entry.file))
  const deletions = Object.keys(remote.files).filter(
    (name) => isAssetFileName(name) && !referenced.has(name),
  )
  const files: Record<string, string | null> = {
    [MANIFEST_FILE]: manifestJson(manifest),
    [CAMPAIGN_FILE]: JSON.stringify(campaign),
  }
  for (const name of deletions) files[name] = null
  const result = await api.updateGist(gistId, files, gistDescription(campaign.name))
  const sha = result.latestSha ?? (await api.latestCommitSha(gistId))
  committed(gistId, sha)
  report('campaign', 1, 1)

  return {
    gistId,
    sha,
    uploadedAssets: uploaded,
    deletedAssets: deletions.length,
    skippedAssets: campaign.library.filter((asset) => asset.localOnly || skippedIds.has(asset.id)),
  }
}

/** The asset's base64, or null when this device cannot upload it as described by its meta. */
async function encodeAsset(deps: SyncDeps, asset: AssetMeta): Promise<string | null> {
  const blob = await deps.readAsset(asset.id)
  if (blob === null || blob.size > SYNC_MAX_BYTES) return null
  const bytes = new Uint8Array(await blob.arrayBuffer())
  // A blob that does not match its hash would fail every other device's check.
  if ((await deps.sha256Hex(bytes)) !== asset.hash) return null
  return bytesToBase64(bytes)
}

/**
 * Reads a campaign gist (or one of its revisions) and stores the assets this
 * device lacks. Network failures abort the pull; a file that is missing,
 * damaged or fails its hash check is reported in `missingAssets` instead.
 */
export async function pullCampaign(
  deps: SyncDeps,
  gistId: string,
  options: PullOptions = {},
): Promise<PullResult> {
  const { api } = deps
  const { revision } = options
  const gist: GistData =
    revision === undefined ? await api.getGist(gistId) : await api.getRevision(gistId, revision)
  if (gist.truncated) throw new SyncError(TOO_MANY_FILES)
  const manifestFile = getFile(gist.files, MANIFEST_FILE)
  if (manifestFile === null) throw new SyncError(NOT_VTT_GIST)
  let manifest: Manifest
  try {
    manifest = parseManifest(await readFile(api, manifestFile))
  } catch (error) {
    if (error instanceof GistFormatError) throw new SyncError(error.message)
    throw error
  }
  const campaignFile = getFile(gist.files, CAMPAIGN_FILE)
  if (manifest.status !== 'complete' || campaignFile === null) {
    throw new SyncError(UPLOAD_UNFINISHED)
  }
  const campaignText = await readFile(api, campaignFile)
  let campaign: unknown
  try {
    campaign = JSON.parse(campaignText)
  } catch {
    throw new SyncError("This gist's campaign.json is damaged (it is not valid JSON).")
  }

  const missing: string[] = []
  let downloaded = 0
  const total = manifest.assets.length
  options.onProgress?.({ done: 0, total })
  for (const [index, entry] of manifest.assets.entries()) {
    const outcome = await downloadAsset(deps, gist, entry)
    if (outcome === 'downloaded') downloaded++
    else if (outcome === 'missing') missing.push(entry.id)
    options.onProgress?.({ done: index + 1, total })
  }

  const sha = revision ?? gist.latestSha ?? (await api.latestCommitSha(gistId))
  return { campaign, manifest, sha, downloadedAssets: downloaded, missingAssets: missing }
}

async function downloadAsset(
  deps: SyncDeps,
  gist: GistData,
  entry: ManifestAsset,
): Promise<'present' | 'downloaded' | 'missing'> {
  if (await deps.hasAsset(entry.id, entry.hash)) return 'present'
  const file = getFile(gist.files, entry.file)
  if (file === null) return 'missing'
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = base64ToBytes(await readFile(deps.api, file))
  } catch (error) {
    // Offline: stop the whole pull rather than report every image missing.
    if (error instanceof GitHubError && error.status === 0) throw error
    if (error instanceof GitHubError || error instanceof GistFormatError) return 'missing'
    if (error instanceof SyncError) return 'missing'
    throw error
  }
  if ((await deps.sha256Hex(bytes)) !== entry.hash) return 'missing'
  await deps.writeAsset(
    { id: entry.id, mime: entry.mime, hash: entry.hash },
    new Blob([bytes], { type: entry.mime }),
  )
  return 'downloaded'
}

/** Whether the gist's latest commit differs from the one this device last synced. */
export async function remoteChanged(deps: SyncDeps, link: SyncLink): Promise<boolean> {
  if (link.gistId === null) return false
  return (await deps.api.latestCommitSha(link.gistId)) !== link.lastSyncedSha
}
