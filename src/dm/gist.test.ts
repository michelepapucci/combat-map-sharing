// oxlint-disable-next-line import/no-unassigned-import -- installs the IDB globals idb needs
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeGitHub, FAKE_TOKEN, type FakeGitHub } from '../gist/fakeGitHub'
import { closeVttDb } from '../persistence/assetBlobs'
import { readGistLink, writeGistLink } from '../persistence/gistLinks'
import { createCampaign } from '../state/defaults'
import type { CampaignState } from '../state/types'
import { commit, getCampaign, loadCampaign } from '../store/campaign'
import { useGistStore } from '../store/gist'
import { settle, useConfirmStore } from './confirm'
import {
  connectGist,
  loadFromGist,
  parseGistId,
  resolveConflict,
  saveToGist,
  startGist,
  stopGist,
  type GistSessionActions,
} from './gist'

/**
 * The DM side of gist sync (src/dm/gist.ts) against the in-memory GitHub of
 * src/gist/fakeGitHub.ts, with IndexedDB from fake-indexeddb and the session
 * replaced by stubs.
 */

let github: FakeGitHub
let actions: GistSessionActions & {
  adopted: CampaignState[]
  copyWorks: boolean
}

function stubSession() {
  const adopted: CampaignState[] = []
  return {
    adopted,
    copyWorks: true,
    adoptCampaign: vi.fn<(campaign: CampaignState) => Promise<boolean>>(async (campaign) => {
      adopted.push(campaign)
      loadCampaign(campaign)
      return true
    }),
    duplicateCampaign: vi.fn<(id: string) => Promise<boolean>>(async () => actions.copyWorks),
    flushSave: vi.fn<() => Promise<void>>(async () => undefined),
  }
}

/** Waits until the confirm/choose dialog is showing. */
async function dialogOpen(): Promise<string> {
  await vi.waitFor(() => {
    if (!useConfirmStore.getState().request) throw new Error('no dialog yet')
  })
  return useConfirmStore.getState().request?.title ?? ''
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  github = createFakeGitHub()
  vi.stubGlobal('fetch', github.fetch)
  loadCampaign(createCampaign('Gist test'))
  actions = stubSession()
  startGist(actions)
  if (!(await connectGist(FAKE_TOKEN, false))) throw new Error('the fake GitHub refused the token')
})

afterEach(async () => {
  stopGist()
  vi.unstubAllGlobals()
  await closeVttDb()
})

describe('gist sync in the DM window', () => {
  it('reads gist ids from what the DM pastes', () => {
    const id = 'aa11bb22cc33dd44ee55ff66aa77bb88'
    expect(parseGistId(id)).toBe(id)
    expect(parseGistId(`https://gist.github.com/someone/${id}`)).toBe(id)
    expect(parseGistId(`gist.github.com/${id}#file-x`)).toBe(id)
    expect(parseGistId('https://evil.example/aa11bb22cc33dd44ee55ff66aa77bb88')).toBeNull()
    expect(parseGistId('hello')).toBeNull()
  })

  it('saves to a new secret gist and shows it as synced', async () => {
    await saveToGist()
    expect(github.gists.size).toBe(1)
    const link = await readGistLink(getCampaign().id)
    expect(link?.gistId).toBe([...github.gists.keys()][0])
    expect(useGistStore.getState()).toMatchObject({ status: 'synced', link })
  })

  it('an interrupted first save resumes in the same gist (never a second gist)', async () => {
    // The gist is created, then the final commit fails.
    github.fail({ status: 422, match: (request) => request.method === 'PATCH' })
    await saveToGist()
    expect(useGistStore.getState().status).toBe('error')
    expect(github.gists.size).toBe(1)
    // The link is known at once, in memory too: the retry continues there, without a conflict.
    expect(useGistStore.getState().link?.gistId).toBe([...github.gists.keys()][0])
    await saveToGist()
    expect(github.gists.size).toBe(1)
    expect(useGistStore.getState().status).toBe('synced')
  })

  it('“Keep a copy, then load” never loads over the campaign when the copy failed', async () => {
    await saveToGist()
    actions.copyWorks = false
    const resolving = resolveConflict()
    await dialogOpen()
    settle('copy')
    await resolving
    expect(actions.duplicateCampaign).toHaveBeenCalledTimes(1)
    expect(actions.adoptCampaign).not.toHaveBeenCalled()
  })

  it('loading asks first whenever there are unsynced changes, whatever the status', async () => {
    await saveToGist()
    commit('Rename', (draft) => {
      draft.name = 'Changed here'
    })
    useGistStore.setState({ status: 'error', error: 'offline' })
    const loading = loadFromGist()
    expect(await dialogOpen()).toBe('Load the gist here?')
    settle(null)
    await loading
    expect(actions.adoptCampaign).not.toHaveBeenCalled()
    expect(getCampaign().name).toBe('Changed here')
  })

  it('a tab that stops syncing forgets the token and writes no more links', async () => {
    await saveToGist()
    const id = getCampaign().id
    const before = await readGistLink(id)
    stopGist()
    expect(useGistStore.getState()).toMatchObject({ token: null, link: null, status: 'off' })
    // A later write from this tab (an old operation finishing) is ignored.
    await saveToGist({ auto: true })
    expect(await readGistLink(id)).toStrictEqual(before)
    // Restart for afterEach.
    startGist(actions)
  })

  it('a link stored for another campaign never applies to the open one', async () => {
    await writeGistLink('someone-else', {
      gistId: 'abc123',
      lastSyncedSha: null,
      syncedUpdatedAt: 0,
      autoSync: true,
      intervalMin: 2,
    })
    await saveToGist()
    const link = await readGistLink(getCampaign().id)
    expect(link?.gistId).not.toBe('abc123')
  })
})
