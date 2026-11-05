// oxlint-disable-next-line import/no-unassigned-import -- installs the IDB globals idb needs
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCampaign } from '../state/defaults'
import type { AssetMeta, CampaignState } from '../state/types'
import { closeVttDb, getAssetBlob } from './assetBlobs'
import {
  collectAssetGarbage,
  getLastCampaignId,
  getThumbnailBlob,
  listCampaigns,
  putAsset,
  readCampaign,
  removeCampaign,
  setLastCampaignId,
  writeCampaign,
} from './db'

function asset(id: string): AssetMeta {
  return {
    id,
    kind: 'map',
    name: id,
    tags: [],
    mime: 'image/png',
    width: 10,
    height: 10,
    bytes: 3,
    hash: '0'.repeat(64),
    defaultSize: null,
    defaultKind: null,
    defaultCells: null,
    localOnly: false,
    createdAt: 0,
  }
}

function campaignWith(name: string, assetIds: string[], updatedAt: number): CampaignState {
  const campaign = createCampaign(name)
  return { ...campaign, library: assetIds.map(asset), updatedAt }
}

describe('IndexedDB persistence', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
  })
  afterEach(async () => {
    await closeVttDb()
  })

  it('stores campaigns and lists them, most recent first', async () => {
    const older = campaignWith('Older', [], 100)
    const newer = campaignWith('Newer', [], 200)
    await writeCampaign(older)
    await writeCampaign(newer)
    expect(await readCampaign(older.id)).toStrictEqual(older)
    expect(await listCampaigns()).toStrictEqual([
      { id: newer.id, name: 'Newer', updatedAt: 200, scenes: 1 },
      { id: older.id, name: 'Older', updatedAt: 100, scenes: 1 },
    ])
    await removeCampaign(older.id)
    expect((await listCampaigns()).map((c) => c.id)).toStrictEqual([newer.id])
  })

  it('remembers the last campaign', async () => {
    expect(await getLastCampaignId()).toBeNull()
    await setLastCampaignId('abc')
    expect(await getLastCampaignId()).toBe('abc')
  })

  it('stores blobs with thumbnails', async () => {
    await putAsset('a1', new Blob(['img'], { type: 'image/png' }), new Blob(['t']))
    expect(await (await getAssetBlob('a1'))?.text()).toBe('img')
    expect(await (await getThumbnailBlob('a1'))?.text()).toBe('t')
    expect(await getAssetBlob('missing')).toBeUndefined()
  })

  it('collects blobs no campaign references, keeping shared and in-flight ones', async () => {
    for (const id of ['shared', 'onlyA', 'orphan', 'uploading', 'unsaved']) {
      await putAsset(id, new Blob([id]), new Blob([id]))
    }
    await writeCampaign(campaignWith('A', ['shared', 'onlyA'], 1))
    await writeCampaign(campaignWith('B', ['shared'], 2))
    const deleted = await collectAssetGarbage(null, () => ['uploading', 'unsaved'])
    expect(deleted).toBe(1)
    expect(await getAssetBlob('orphan')).toBeUndefined()
    expect(await getThumbnailBlob('orphan')).toBeUndefined()
    for (const id of ['shared', 'onlyA', 'uploading', 'unsaved']) {
      expect(await getAssetBlob(id)).toBeDefined()
    }
  })

  it("uses the open campaign's in-memory library, not its stale stored record", async () => {
    // The open campaign deleted "old" in memory, but saving failed (disk full).
    const open = campaignWith('Open', ['old', 'kept'], 1)
    await writeCampaign(open)
    await putAsset('old', new Blob(['o']), null)
    await putAsset('kept', new Blob(['k']), null)
    expect(await collectAssetGarbage(open.id, () => ['kept'])).toBe(1)
    expect(await getAssetBlob('old')).toBeUndefined()
    expect(await getAssetBlob('kept')).toBeDefined()
  })

  it('evaluates the ids to keep after reading, inside the transaction', async () => {
    await putAsset('late', new Blob(['l']), null)
    let asked = false
    await collectAssetGarbage(null, () => {
      asked = true
      return ['late']
    })
    expect(asked).toBe(true)
    expect(await getAssetBlob('late')).toBeDefined()
  })

  it('lists unreadable records instead of failing', async () => {
    const { openVttDb } = await import('./assetBlobs')
    const db = await openVttDb()
    await db.put('campaigns', 'garbage', 'broken')
    expect(await listCampaigns()).toStrictEqual([
      { id: 'broken', name: 'Unreadable campaign', updatedAt: 0, scenes: 0 },
    ])
  })
})
