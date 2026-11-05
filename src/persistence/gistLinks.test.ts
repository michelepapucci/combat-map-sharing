// oxlint-disable-next-line import/no-unassigned-import -- installs the IDB globals idb needs
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { closeVttDb } from './assetBlobs'
import {
  forgetToken,
  parseGistLink,
  readGistLink,
  readSavedToken,
  removeGistLink,
  saveToken,
  writeGistLink,
} from './gistLinks'

afterEach(async () => {
  await closeVttDb()
  indexedDB.deleteDatabase('vtt')
})

describe('device-local gist data', () => {
  it('keeps only well-formed link fields', () => {
    expect(parseGistLink(null)).toBeNull()
    expect(parseGistLink({ gistId: '../evil' })).toBeNull()
    expect(
      parseGistLink({
        gistId: 'abc123',
        lastSyncedSha: 'not a sha!',
        syncedUpdatedAt: Number.NaN,
        autoSync: 'yes',
        intervalMin: 7,
        extra: 'dropped',
      }),
    ).toStrictEqual({
      gistId: 'abc123',
      lastSyncedSha: null,
      syncedUpdatedAt: 0,
      autoSync: false,
      intervalMin: 2,
    })
  })

  it('stores the token and per-campaign links in IndexedDB, and forgets them', async () => {
    expect(await readSavedToken()).toBeNull()
    await saveToken('github_pat_abc')
    expect(await readSavedToken()).toBe('github_pat_abc')
    await forgetToken()
    expect(await readSavedToken()).toBeNull()

    const link = {
      gistId: 'f00d',
      lastSyncedSha: 'a1b2c3',
      syncedUpdatedAt: 42,
      autoSync: true,
      intervalMin: 5,
    }
    await writeGistLink('campaign-1', link)
    expect(await readGistLink('campaign-1')).toStrictEqual(link)
    expect(await readGistLink('campaign-2')).toBeNull()
    await removeGistLink('campaign-1')
    expect(await readGistLink('campaign-1')).toBeNull()
  })
})
