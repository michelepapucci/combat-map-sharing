import { describe, expect, it } from 'vitest'
import { SYNC_MAX_BYTES } from '../assets/upload/plan'
import { sampleCampaign } from '../state/fixtures/sampleCampaign'
import type { AssetMeta, CampaignState } from '../state/types'
import { createGistApi, GitHubError } from './api'
import { createFakeGitHub, FAKE_TOKEN, type FakeGitHub, type FakeRequest } from './fakeGitHub'
import {
  assetFileName,
  base64ToBytes,
  bytesToBase64,
  CAMPAIGN_FILE,
  MANIFEST_FILE,
  MAX_SYNCED_ASSETS,
  parseManifest,
} from './serialize'
import {
  ConflictError,
  pullCampaign,
  pushCampaign,
  remoteChanged,
  SyncError,
  type PushProgress,
  type SyncDeps,
  type SyncLink,
} from './sync'

const NEW: SyncLink = { gistId: null, lastSyncedSha: null }
const RAW_ORIGIN = 'https://gist.githubusercontent.com/'

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length)
  for (let start = 0; start < length; start += 65536) {
    crypto.getRandomValues(bytes.subarray(start, start + 65536))
  }
  return bytes
}

interface StoredBlob {
  mime: string
  hash: string
  bytes: Uint8Array<ArrayBuffer>
}

/** A browser profile: its own asset store, talking to the shared fake GitHub. */
interface Device {
  deps: SyncDeps
  blobs: Map<string, StoredBlob>
  /** Ids passed to writeAsset, in order. */
  writes: string[]
}

function createDevice(fake: FakeGitHub): Device {
  const blobs = new Map<string, StoredBlob>()
  const writes: string[] = []
  const api = createGistApi(FAKE_TOKEN, { fetch: fake.fetch, sleep: () => Promise.resolve() })
  return {
    blobs,
    writes,
    deps: {
      api,
      readAsset: async (id) => {
        const stored = blobs.get(id)
        return stored ? new Blob([stored.bytes], { type: stored.mime }) : null
      },
      hasAsset: async (id, hash) => blobs.get(id)?.hash === hash,
      writeAsset: async (meta, blob) => {
        expect(blob.type).toBe(meta.mime)
        writes.push(meta.id)
        blobs.set(meta.id, {
          mime: meta.mime,
          hash: meta.hash,
          bytes: new Uint8Array(await blob.arrayBuffer()),
        })
      },
      sha256Hex,
    },
  }
}

/** Gives a library asset fresh random content, on the device and in its meta. */
async function setContent(device: Device, asset: AssetMeta, size: number): Promise<void> {
  const bytes = randomBytes(size)
  asset.bytes = size
  asset.hash = await sha256Hex(bytes)
  device.blobs.set(asset.id, { mime: asset.mime, hash: asset.hash, bytes })
}

function libraryAsset(campaign: CampaignState, id: string): AssetMeta {
  const asset = campaign.library.find((a) => a.id === id)
  if (!asset) throw new Error(`no asset ${id}`)
  return asset
}

/**
 * The sample campaign with 3 uploaded assets (map 3000 B, token 4500 B, a
 * second token 6000 B: 4000, 6000 and 8000 base64 characters) and 1 local-only
 * prop (also stored on the device).
 */
async function makeCampaign(device: Device): Promise<CampaignState> {
  const campaign = structuredClone(sampleCampaign)
  const token = libraryAsset(campaign, 'asset-token-1')
  campaign.library.push({ ...structuredClone(token), id: 'asset-token-2', name: 'Goblin face' })
  await setContent(device, libraryAsset(campaign, 'asset-map-1'), 3000)
  await setContent(device, libraryAsset(campaign, 'asset-token-1'), 4500)
  await setContent(device, libraryAsset(campaign, 'asset-token-2'), 6000)
  await setContent(device, libraryAsset(campaign, 'asset-prop-1'), 1000)
  return campaign
}

const SYNCED = ['asset-map-1', 'asset-token-1', 'asset-token-2']

function patches(fake: FakeGitHub, from = 0): FakeRequest[] {
  return fake.requests.slice(from).filter((r) => r.method === 'PATCH')
}

/** Files a request body sets (non-null) and deletes (null). */
function bodyFiles(request: FakeRequest): { set: Record<string, string>; deleted: string[] } {
  const body = request.body as { files?: Record<string, { content: string } | null> }
  const set: Record<string, string> = {}
  const deleted: string[] = []
  for (const [name, value] of Object.entries(body.files ?? {})) {
    if (value === null) deleted.push(name)
    else set[name] = value.content
  }
  return { set, deleted }
}

function assetFilesIn(request: FakeRequest): string[] {
  return Object.keys(bodyFiles(request).set).filter((name) => name.startsWith('asset-'))
}

/**
 * The remote invariant, at every commit of the gist: each asset the manifest
 * lists has its file, and the file decodes to exactly that hash.
 */
async function expectConsistentHistory(fake: FakeGitHub, gistId: string): Promise<void> {
  const gist = fake.gists.get(gistId)
  if (!gist) throw new Error('no gist')
  for (const commit of gist.history) {
    const text = commit.files[MANIFEST_FILE]
    if (text === undefined) continue
    const manifest = parseManifest(text)
    for (const asset of manifest.assets) {
      const content = commit.files[asset.file]
      expect(content, `${asset.file} at ${commit.sha}`).toBeDefined()
      expect(await sha256Hex(base64ToBytes(content ?? ''))).toBe(asset.hash)
    }
  }
}

function isRawToken1(request: FakeRequest): boolean {
  return request.url.startsWith(RAW_ORIGIN) && request.url.endsWith(assetFileName('asset-token-1'))
}

function remoteCampaign(fake: FakeGitHub, gistId: string): unknown {
  return JSON.parse(fake.latestFiles(gistId)[CAMPAIGN_FILE] ?? 'null')
}

function remoteManifest(fake: FakeGitHub, gistId: string) {
  return parseManifest(fake.latestFiles(gistId)[MANIFEST_FILE] ?? '')
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected a rejection')
}

describe('push and pull', () => {
  it('round-trips a campaign through a new secret gist onto a fresh device', async () => {
    const fake = createFakeGitHub()
    const a = createDevice(fake)
    const campaign = await makeCampaign(a)
    const progress: PushProgress[] = []
    const commits: string[] = []
    const result = await pushCampaign(a.deps, campaign, NEW, {
      onProgress: (p) => progress.push(p),
      onCommit: (link) => commits.push(link.lastSyncedSha),
    })

    const gist = fake.gists.get(result.gistId)
    expect(gist?.public).toBe(false)
    expect(gist?.description).toBe('VTT campaign: Test Campaign')
    expect(result.sha).toBe(gist?.history[0]?.sha)
    expect(result.uploadedAssets).toBe(3)
    expect(result.deletedAssets).toBe(0)
    expect(result.skippedAssets.map((asset) => asset.id)).toStrictEqual(['asset-prop-1'])
    expect(commits).toStrictEqual(gist?.history.map((c) => c.sha).toReversed())
    expect(Object.keys(fake.latestFiles(result.gistId)).toSorted()).toStrictEqual([
      ...SYNCED.map(assetFileName),
      CAMPAIGN_FILE,
      MANIFEST_FILE,
    ])
    const manifest = remoteManifest(fake, result.gistId)
    expect(manifest.status).toBe('complete')
    expect(manifest.assets.map((asset) => asset.id)).toStrictEqual(SYNCED)
    expect(remoteCampaign(fake, result.gistId)).toStrictEqual(campaign)
    expect(progress[0]).toStrictEqual({ phase: 'checking', done: 0, total: 1 })
    expect(progress).toContainEqual({ phase: 'assets', done: 3, total: 3 })
    expect(progress.at(-1)).toStrictEqual({ phase: 'campaign', done: 1, total: 1 })
    await expectConsistentHistory(fake, result.gistId)

    const b = createDevice(fake)
    const pulled = await pullCampaign(b.deps, result.gistId)
    expect(pulled.campaign).toStrictEqual(campaign)
    expect(pulled.manifest).toStrictEqual(manifest)
    expect(pulled.sha).toBe(result.sha)
    expect(pulled.downloadedAssets).toBe(3)
    expect(pulled.missingAssets).toStrictEqual([])
    for (const id of SYNCED) {
      expect(b.blobs.get(id)).toStrictEqual(a.blobs.get(id))
    }
    expect(b.blobs.has('asset-prop-1')).toBe(false)
  })

  it('uploads only changed assets and deletes the files nothing references', async () => {
    const fake = createFakeGitHub()
    const a = createDevice(fake)
    const campaign = await makeCampaign(a)
    const first = await pushCampaign(a.deps, campaign, NEW)
    const b = createDevice(fake)
    await pullCampaign(b.deps, first.gistId)
    b.writes.length = 0

    await setContent(a, libraryAsset(campaign, 'asset-token-1'), 4400)
    campaign.library = campaign.library.filter((asset) => asset.id !== 'asset-token-2')
    campaign.updatedAt += 1000
    const start = fake.requests.length
    const second = await pushCampaign(a.deps, campaign, {
      gistId: first.gistId,
      lastSyncedSha: first.sha,
    })
    expect(second.gistId).toBe(first.gistId)
    expect(second.uploadedAssets).toBe(1)
    expect(second.deletedAssets).toBe(1)
    expect(second.skippedAssets.map((asset) => asset.id)).toStrictEqual(['asset-prop-1'])
    const sent = patches(fake, start)
    expect(sent.flatMap(assetFilesIn)).toStrictEqual([assetFileName('asset-token-1')])
    expect(sent.flatMap((r) => bodyFiles(r).deleted)).toStrictEqual([
      assetFileName('asset-token-2'),
    ])
    // The deletion goes with the final manifest and campaign.json.
    const final = sent.at(-1)
    if (!final) throw new Error('no final PATCH')
    expect(Object.keys(bodyFiles(final).set).toSorted()).toStrictEqual([
      CAMPAIGN_FILE,
      MANIFEST_FILE,
    ])
    expect(Object.keys(fake.latestFiles(first.gistId)).toSorted()).toStrictEqual([
      assetFileName('asset-map-1'),
      assetFileName('asset-token-1'),
      CAMPAIGN_FILE,
      MANIFEST_FILE,
    ])
    await expectConsistentHistory(fake, first.gistId)

    // Device B downloads only the changed asset.
    const pulled = await pullCampaign(b.deps, first.gistId)
    expect(pulled.campaign).toStrictEqual(campaign)
    expect(pulled.downloadedAssets).toBe(1)
    expect(b.writes).toStrictEqual(['asset-token-1'])
    expect(b.blobs.get('asset-token-1')).toStrictEqual(a.blobs.get('asset-token-1'))
  })

  it('sends only the final commit when no asset changed, and no commit when nothing did', async () => {
    const fake = createFakeGitHub()
    const a = createDevice(fake)
    const campaign = await makeCampaign(a)
    const first = await pushCampaign(a.deps, campaign, NEW)
    const start = fake.requests.length
    const again = await pushCampaign(a.deps, campaign, {
      gistId: first.gistId,
      lastSyncedSha: first.sha,
    })
    expect(fake.requests.slice(start).map((r) => r.method)).toStrictEqual(['GET', 'GET', 'PATCH'])
    expect(again.uploadedAssets).toBe(0)
    expect(again.deletedAssets).toBe(0)
    // Identical content: git records no commit, the SHA stays.
    expect(again.sha).toBe(first.sha)

    campaign.name = 'Renamed'
    const renamed = await pushCampaign(a.deps, campaign, {
      gistId: first.gistId,
      lastSyncedSha: again.sha,
    })
    expect(renamed.sha).not.toBe(first.sha)
    expect(fake.gists.get(first.gistId)?.description).toBe('VTT campaign: Renamed')
  })

  it('splits uploads into PATCHes under the byte budget', async () => {
    const fake = createFakeGitHub()
    const a = createDevice(fake)
    const campaign = await makeCampaign(a)
    // 4000 + 6000 characters fit 10 000; the 8000 go in a second batch.
    await pushCampaign(a.deps, campaign, NEW, { byteBudget: 10_000 })
    const sent = patches(fake)
    expect(sent.map(assetFilesIn)).toStrictEqual([
      [assetFileName('asset-map-1'), assetFileName('asset-token-1')],
      [assetFileName('asset-token-2')],
      [],
    ])
    for (const request of sent.slice(0, -1)) {
      const { set } = bodyFiles(request)
      const chars = assetFilesIn(request).reduce((sum, name) => sum + (set[name]?.length ?? 0), 0)
      expect(chars).toBeLessThanOrEqual(10_000)
      // Each batch updates the manifest with what is now in the gist.
      expect(parseManifest(set[MANIFEST_FILE] ?? '').status).toBe('uploading')
    }
    const lastBatch = sent[1]
    if (!lastBatch) throw new Error('no second batch')
    expect(
      parseManifest(bodyFiles(lastBatch).set[MANIFEST_FILE] ?? '').assets.map((x) => x.id),
    ).toStrictEqual(SYNCED)

    // A budget smaller than any file: each goes alone.
    const fake2 = createFakeGitHub()
    const b = createDevice(fake2)
    const other = await makeCampaign(b)
    const result = await pushCampaign(b.deps, other, NEW, { byteBudget: 100 })
    expect(patches(fake2).map(assetFilesIn)).toStrictEqual([
      [assetFileName('asset-map-1')],
      [assetFileName('asset-token-1')],
      [assetFileName('asset-token-2')],
      [],
    ])
    expect(fake2.requests).toHaveLength(1 + 4) // POST + 4 PATCHes
    await expectConsistentHistory(fake2, result.gistId)
    const pulled = await pullCampaign(createDevice(fake2).deps, result.gistId)
    expect(pulled.campaign).toStrictEqual(other)
  })

  it('resumes an interrupted push where it stopped', async () => {
    const fake = createFakeGitHub()
    const a = createDevice(fake)
    const campaign = await makeCampaign(a)
    const third = assetFileName('asset-token-2')
    fake.fail({
      status: 500,
      match: (r) => r.method === 'PATCH' && JSON.stringify(r.body).includes(third),
    })
    let link: SyncLink = NEW
    const error = await rejection(
      pushCampaign(a.deps, campaign, NEW, {
        byteBudget: 100,
        onCommit: (committed) => {
          link = committed
        },
      }),
    )
    expect(error).toBeInstanceOf(GitHubError)
    if (link.gistId === null) throw new Error('onCommit was not called')
    const gistId = link.gistId
    expect(link.lastSyncedSha).toBe(fake.gists.get(gistId)?.history[0]?.sha)
    expect(remoteManifest(fake, gistId).status).toBe('uploading')
    expect(remoteManifest(fake, gistId).assets.map((x) => x.id)).toStrictEqual([
      'asset-map-1',
      'asset-token-1',
    ])
    await expectConsistentHistory(fake, gistId)

    // Nobody can load the half-uploaded gist.
    const b = createDevice(fake)
    const unfinished = await rejection(pullCampaign(b.deps, gistId))
    expect(unfinished).toBeInstanceOf(SyncError)
    expect((unfinished as Error).message).toBe(
      "This gist's upload never finished: push again from the device that has the campaign",
    )

    const start = fake.requests.length
    const resumed = await pushCampaign(a.deps, campaign, link)
    expect(resumed.gistId).toBe(gistId)
    expect(resumed.uploadedAssets).toBe(1)
    expect(patches(fake, start).flatMap(assetFilesIn)).toStrictEqual([third])
    expect(fake.gists.size).toBe(1)
    const pulled = await pullCampaign(b.deps, gistId)
    expect(pulled.campaign).toStrictEqual(campaign)
    expect(pulled.downloadedAssets).toBe(3)
  })

  it('reads truncated files through their raw URLs with a bare fetch', async () => {
    const fake = createFakeGitHub({ truncateOver: 500 })
    const a = createDevice(fake)
    const campaign = await makeCampaign(a)
    const first = await pushCampaign(a.deps, campaign, NEW)
    // The second push reads the (truncated) remote manifest.
    const start = fake.requests.length
    await pushCampaign(a.deps, campaign, { gistId: first.gistId, lastSyncedSha: first.sha })
    const pushRaw = fake.requests.slice(start).filter((r) => r.url.startsWith(RAW_ORIGIN))
    expect(pushRaw.map((r) => decodeURIComponent(r.url.split('/').at(-1) ?? ''))).toStrictEqual([
      MANIFEST_FILE,
    ])

    const b = createDevice(fake)
    const pullStart = fake.requests.length
    const pulled = await pullCampaign(b.deps, first.gistId)
    expect(pulled.campaign).toStrictEqual(campaign)
    expect(pulled.missingAssets).toStrictEqual([])
    for (const id of SYNCED) expect(b.blobs.get(id)).toStrictEqual(a.blobs.get(id))
    const raw = fake.requests.slice(pullStart).filter((r) => r.url.startsWith(RAW_ORIGIN))
    expect(raw).toHaveLength(2 + SYNCED.length) // manifest, campaign.json, assets
    for (const request of fake.requests.filter((r) => r.url.startsWith(RAW_ORIGIN))) {
      expect(request.argCount).toBe(1)
      expect(request.headers).toStrictEqual({})
      expect(request.url).not.toContain(FAKE_TOKEN)
    }
  })

  it('pulls an earlier revision', async () => {
    const fake = createFakeGitHub()
    const a = createDevice(fake)
    const campaign = await makeCampaign(a)
    campaign.name = 'One'
    const v1 = await pushCampaign(a.deps, campaign, NEW)
    const one = structuredClone(campaign)
    campaign.name = 'Two'
    await setContent(a, libraryAsset(campaign, 'asset-map-1'), 3100)
    const v2 = await pushCampaign(a.deps, campaign, { gistId: v1.gistId, lastSyncedSha: v1.sha })
    expect(v2.sha).not.toBe(v1.sha)

    const b = createDevice(fake)
    const old = await pullCampaign(b.deps, v1.gistId, { revision: v1.sha ?? '' })
    expect(old.campaign).toStrictEqual(one)
    expect(old.manifest.name).toBe('One')
    expect(old.sha).toBe(v1.sha)
    expect(old.missingAssets).toStrictEqual([])
    // The old map content, as it was at that revision.
    expect(b.blobs.get('asset-map-1')?.hash).toBe(libraryAsset(one, 'asset-map-1').hash)
    expect(fake.requests.some((r) => r.url.endsWith(`/gists/${v1.gistId}/${v1.sha}`))).toBe(true)

    const latest = await pullCampaign(b.deps, v1.gistId, { revision: undefined })
    expect((latest.campaign as CampaignState).name).toBe('Two')
    expect(latest.sha).toBe(v2.sha)
  })
})

describe('pull problems', () => {
  it('reports assets that fail the hash check, are not base64 or are missing', async () => {
    const fake = createFakeGitHub()
    const a = createDevice(fake)
    const campaign = await makeCampaign(a)
    const { gistId } = await pushCampaign(a.deps, campaign, NEW)
    await a.deps.api.updateGist(gistId, {
      [assetFileName('asset-token-1')]: bytesToBase64(randomBytes(4500)),
      [assetFileName('asset-token-2')]: 'this is not base64!',
    })
    const b = createDevice(fake)
    const pulled = await pullCampaign(b.deps, gistId)
    expect(pulled.campaign).toStrictEqual(campaign)
    expect(pulled.downloadedAssets).toBe(1)
    expect(pulled.missingAssets).toStrictEqual(['asset-token-1', 'asset-token-2'])
    expect([...b.blobs.keys()]).toStrictEqual(['asset-map-1'])

    await a.deps.api.updateGist(gistId, { [assetFileName('asset-map-1')]: null })
    const c = createDevice(fake)
    expect((await pullCampaign(c.deps, gistId)).missingAssets).toStrictEqual(SYNCED)
    expect(c.writes).toStrictEqual([])
  })

  it('reports an asset whose raw download fails, but stops when offline', async () => {
    const fake = createFakeGitHub({ truncateOver: 500 })
    const a = createDevice(fake)
    const campaign = await makeCampaign(a)
    const { gistId } = await pushCampaign(a.deps, campaign, NEW)
    fake.fail({ status: 404, match: isRawToken1 })
    const pulled = await pullCampaign(createDevice(fake).deps, gistId)
    expect(pulled.missingAssets).toStrictEqual(['asset-token-1'])
    expect(pulled.downloadedAssets).toBe(2)

    fake.fail({ network: true, match: isRawToken1 }, { network: true, match: isRawToken1 })
    const offline = await rejection(pullCampaign(createDevice(fake).deps, gistId))
    expect(offline).toBeInstanceOf(GitHubError)
    expect((offline as GitHubError).status).toBe(0)
  })

  it('refuses gists that are not VTT campaigns or are damaged', async () => {
    const fake = createFakeGitHub()
    const a = createDevice(fake)
    const notes = fake.seedGist({ 'notes.md': '# Session notes' })
    await expect(pullCampaign(a.deps, notes.id)).rejects.toThrow(
      new SyncError('Not a VTT campaign gist'),
    )
    const foreign = fake.seedGist({ [MANIFEST_FILE]: '{"app":"another-vtt"}' })
    await expect(pullCampaign(a.deps, foreign.id)).rejects.toThrow(/not made by this app/)
    await expect(pullCampaign(a.deps, foreign.id)).rejects.toBeInstanceOf(SyncError)

    const campaign = await makeCampaign(a)
    const { gistId } = await pushCampaign(a.deps, campaign, NEW)
    await a.deps.api.updateGist(gistId, { [CAMPAIGN_FILE]: '{"version": 2, ' })
    await expect(pullCampaign(a.deps, gistId)).rejects.toThrow(/campaign\.json is damaged/)
    await a.deps.api.updateGist(gistId, { [CAMPAIGN_FILE]: null })
    await expect(pullCampaign(a.deps, gistId)).rejects.toThrow(/upload never finished/)
  })

  it('refuses a gist with more files than GitHub lists', async () => {
    const fake = createFakeGitHub({ maxListedFiles: 4 })
    const a = createDevice(fake)
    const campaign = await makeCampaign(a)
    const first = await pushCampaign(a.deps, campaign, NEW)
    expect(Object.keys(fake.latestFiles(first.gistId))).toHaveLength(5)
    await expect(pullCampaign(a.deps, first.gistId)).rejects.toThrow(/more files than GitHub lists/)
    await expect(
      pushCampaign(a.deps, campaign, { gistId: first.gistId, lastSyncedSha: first.sha }),
    ).rejects.toBeInstanceOf(SyncError)
    // Even an overwrite cannot see which files to delete.
    await expect(
      pushCampaign(
        a.deps,
        campaign,
        { gistId: first.gistId, lastSyncedSha: null },
        { force: true },
      ),
    ).rejects.toBeInstanceOf(SyncError)
  })
})

describe('conflicts', () => {
  it('stops a push when another device pushed, and overwrites only when forced', async () => {
    const fake = createFakeGitHub()
    const a = createDevice(fake)
    const campaign = await makeCampaign(a)
    const first = await pushCampaign(a.deps, campaign, NEW)
    const linkA: SyncLink = { gistId: first.gistId, lastSyncedSha: first.sha }

    const b = createDevice(fake)
    const pulled = await pullCampaign(b.deps, first.gistId)
    const fromB = structuredClone(pulled.campaign as CampaignState)
    fromB.name = 'Edited on B'
    const pushB = await pushCampaign(b.deps, fromB, {
      gistId: first.gistId,
      lastSyncedSha: pulled.sha,
    })

    expect(await remoteChanged(a.deps, linkA)).toBe(true)
    expect(await remoteChanged(b.deps, { gistId: first.gistId, lastSyncedSha: pushB.sha })).toBe(
      false,
    )
    expect(await remoteChanged(a.deps, NEW)).toBe(false)

    campaign.name = 'Edited on A'
    const start = fake.requests.length
    const conflict = await rejection(pushCampaign(a.deps, campaign, linkA))
    expect(conflict).toBeInstanceOf(ConflictError)
    expect((conflict as ConflictError).remoteSha).toBe(pushB.sha)
    expect((conflict as ConflictError).message).toBe(
      'The gist changed since this device last synced it',
    )
    expect(patches(fake, start)).toStrictEqual([])
    expect(remoteCampaign(fake, first.gistId)).toStrictEqual(fromB)

    const forced = await pushCampaign(a.deps, campaign, linkA, { force: true })
    expect(remoteCampaign(fake, first.gistId)).toStrictEqual(campaign)
    expect(await remoteChanged(a.deps, { gistId: first.gistId, lastSyncedSha: forced.sha })).toBe(
      false,
    )
  })

  it('treats a link without a SHA as a conflict with an existing gist', async () => {
    const fake = createFakeGitHub()
    const a = createDevice(fake)
    const campaign = await makeCampaign(a)
    const { gistId, sha } = await pushCampaign(a.deps, campaign, NEW)
    const conflict = await rejection(
      pushCampaign(a.deps, campaign, { gistId, lastSyncedSha: null }),
    )
    expect(conflict).toBeInstanceOf(ConflictError)
    expect((conflict as ConflictError).remoteSha).toBe(sha)
  })

  it('stops when another device pushes while this one uploads images', async () => {
    const fake = createFakeGitHub()
    const a = createDevice(fake)
    const campaign = await makeCampaign(a)
    const first = await pushCampaign(a.deps, campaign, NEW)
    for (const id of SYNCED) await setContent(a, libraryAsset(campaign, id), 2000)

    const other = createGistApi(FAKE_TOKEN, { fetch: fake.fetch })
    const readAsset = a.deps.readAsset
    const deps: SyncDeps = {
      ...a.deps,
      readAsset: async (id) => {
        // Reading the last image: the first batch is uploaded, the second not yet.
        if (id === 'asset-token-2') await other.updateGist(first.gistId, { 'notes.md': 'B' })
        return readAsset(id)
      },
    }
    const start = fake.requests.length
    const conflict = await rejection(
      pushCampaign(
        deps,
        campaign,
        { gistId: first.gistId, lastSyncedSha: first.sha },
        {
          byteBudget: 100,
        },
      ),
    )
    expect(conflict).toBeInstanceOf(ConflictError)
    expect(patches(fake, start).map(assetFilesIn)).toStrictEqual([
      [assetFileName('asset-map-1')],
      [], // the other device's commit
    ])
    await expectConsistentHistory(fake, first.gistId)
  })

  it('overwrites a gist without a readable manifest only when forced', async () => {
    const fake = createFakeGitHub()
    const a = createDevice(fake)
    const campaign = await makeCampaign(a)
    const gist = fake.seedGist({
      'notes.md': 'keep me',
      [MANIFEST_FILE]: 'not json',
      [assetFileName('stale')]: 'AAAA',
    })
    const sha = gist.history[0]?.sha ?? null
    await expect(
      pushCampaign(a.deps, campaign, { gistId: gist.id, lastSyncedSha: sha }),
    ).rejects.toThrow(new SyncError('The gist manifest is not valid JSON.'))
    const result = await pushCampaign(
      a.deps,
      campaign,
      { gistId: gist.id, lastSyncedSha: null },
      { force: true },
    )
    expect(result.uploadedAssets).toBe(3)
    expect(result.deletedAssets).toBe(1)
    expect(Object.keys(fake.latestFiles(gist.id)).toSorted()).toStrictEqual([
      ...SYNCED.map(assetFileName),
      CAMPAIGN_FILE,
      'notes.md',
      MANIFEST_FILE,
    ])
    expect(fake.latestFiles(gist.id)['notes.md']).toBe('keep me')
    const pulled = await pullCampaign(createDevice(fake).deps, gist.id)
    expect(pulled.campaign).toStrictEqual(campaign)
  })
})

describe('assets that cannot sync', () => {
  it('refuses more than MAX_SYNCED_ASSETS images before any request', async () => {
    const fake = createFakeGitHub()
    const a = createDevice(fake)
    const campaign = structuredClone(sampleCampaign)
    const template = libraryAsset(campaign, 'asset-token-1')
    campaign.library = Array.from({ length: MAX_SYNCED_ASSETS + 1 }, (_, i) => ({
      ...structuredClone(template),
      id: `asset-${i}`,
    }))
    await expect(pushCampaign(a.deps, campaign, NEW)).rejects.toThrow(
      new SyncError(
        'Too many images to sync: 291 (at most 290). Delete unused images or keep some local-only.',
      ),
    )
    expect(fake.requests).toStrictEqual([])

    // Local-only images do not count.
    const last = campaign.library.at(-1)
    if (last) last.localOnly = true
    const result = await pushCampaign(a.deps, campaign, NEW)
    expect(result.skippedAssets).toHaveLength(MAX_SYNCED_ASSETS + 1)
  })

  it('skips images missing on this device, damaged or too large, and drops their stale files', async () => {
    const fake = createFakeGitHub()
    const a = createDevice(fake)
    const campaign = await makeCampaign(a)
    const first = await pushCampaign(a.deps, campaign, NEW)

    // map-1: the meta changed but the blob did not (damaged); token-1: blob gone;
    // token-2: too large to sync.
    libraryAsset(campaign, 'asset-map-1').hash = 'f'.repeat(64)
    libraryAsset(campaign, 'asset-token-1').hash = 'e'.repeat(64)
    a.blobs.delete('asset-token-1')
    await setContent(a, libraryAsset(campaign, 'asset-token-2'), 10)
    const big = new Blob([new Uint8Array(SYNC_MAX_BYTES + 1)], { type: 'image/png' })
    const deps: SyncDeps = {
      ...a.deps,
      readAsset: (id) => (id === 'asset-token-2' ? Promise.resolve(big) : a.deps.readAsset(id)),
    }
    const result = await pushCampaign(deps, campaign, {
      gistId: first.gistId,
      lastSyncedSha: first.sha,
    })
    expect(result.uploadedAssets).toBe(0)
    expect(result.skippedAssets.map((asset) => asset.id)).toStrictEqual([
      'asset-map-1',
      'asset-token-1',
      'asset-prop-1',
      'asset-token-2',
    ])
    expect(result.deletedAssets).toBe(3)
    expect(remoteManifest(fake, first.gistId).assets).toStrictEqual([])
    expect(Object.keys(fake.latestFiles(first.gistId)).toSorted()).toStrictEqual([
      CAMPAIGN_FILE,
      MANIFEST_FILE,
    ])
  })

  it('keeps a remote image this device lacks when its hash is unchanged', async () => {
    const fake = createFakeGitHub()
    const a = createDevice(fake)
    const campaign = await makeCampaign(a)
    const first = await pushCampaign(a.deps, campaign, NEW)
    a.blobs.delete('asset-map-1')
    campaign.name = 'Later'
    const result = await pushCampaign(a.deps, campaign, {
      gistId: first.gistId,
      lastSyncedSha: first.sha,
    })
    expect(result.skippedAssets.map((asset) => asset.id)).toStrictEqual(['asset-prop-1'])
    expect(remoteManifest(fake, first.gistId).assets.map((x) => x.id)).toStrictEqual(SYNCED)
  })
})
