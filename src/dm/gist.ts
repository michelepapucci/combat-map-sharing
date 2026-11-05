import {
  createGistApi,
  GitHubError,
  type GistApi,
  type GistCommit,
  type GistSummary,
} from '../gist/api'
import { isVttGist } from '../gist/serialize'
import {
  ConflictError,
  pullCampaign,
  pushCampaign,
  SyncError,
  type PushResult,
  type SyncDeps,
} from '../gist/sync'
import { getAssetBlob } from '../persistence/assetBlobs'
import { putAsset } from '../persistence/db'
import {
  DEFAULT_AUTO_SYNC_MINUTES,
  forgetToken,
  readGistLink,
  readSavedToken,
  removeGistLink,
  saveToken,
  writeGistLink,
  type GistLink,
} from '../persistence/gistLinks'
import { newId } from '../state/ids'
import { migrateToCurrent } from '../state/migrations'
import type { CampaignState } from '../state/types'
import { MAX_NAME_LENGTH, validateCampaign } from '../state/validate'
import { getCampaign, useCampaignStore } from '../store/campaign'
import { initialGistState, useGistStore, type GistState } from '../store/gist'
import { useSessionStore } from '../store/session'
import { notify, notifySticky, useUiStore } from '../store/ui'
import { chooseAction, confirmAction } from './confirm'
import { pendingUploads } from './pendingUploads'

/**
 * Gist sync in the DM window (SPEC §7, CLAUDE.md "Gist (M8)"): the token, the
 * open campaign's gist link, saving and loading, conflicts, history and
 * auto-sync. Runs only in the tab that holds the DM lock (started by the
 * session's claim, stopped when it steps aside, which drops the token from
 * memory). The token stays in memory (and in IndexedDB only when remembered)
 * and is never logged or shown.
 */

/** What gist sync needs from the DM session (passed in by it, so neither imports the other). */
export interface GistSessionActions {
  adoptCampaign(campaign: CampaignState): Promise<boolean>
  /** True when the copy was stored. */
  duplicateCampaign(id: string): Promise<boolean>
  flushSave(): Promise<void>
}

let session: GistSessionActions | null = null
let api: GistApi | null = null
let syncing = false
let running = false
let unsubscribe: (() => void) | null = null
let timer: ReturnType<typeof setInterval> | null = null
let lastAutoAttempt = 0
/** HTTP status of the last failure (0: network or other): a rejected token (401) stops auto-sync. */
let lastErrorStatus: number | null = null
/** Bumped when this tab stops (or starts) syncing: older operations then write nothing. */
let gistEpoch = 0
/** The campaign the store's link belongs to (it loads asynchronously after a switch). */
let linkFor: string | null = null
/** Local-only images last reported per campaign, so auto-sync does not repeat the notice. */
const reportedSkipped = new Map<string, string>()

function set(patch: Partial<GistState>): void {
  useGistStore.setState(patch)
}

function live(at: number): boolean {
  return running && at === gistEpoch
}

function errorText(error: unknown): string {
  if (error instanceof GitHubError || error instanceof SyncError) return error.message
  return error instanceof Error ? error.message : String(error)
}

function failed(error: unknown): void {
  lastErrorStatus = error instanceof GitHubError ? error.status : 0
  set({
    status: 'error',
    error: errorText(error),
    rateLimit: error instanceof GitHubError ? error.rateLimit : null,
  })
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Sync dependencies. Downloaded images join pendingUploads (listed in `written`)
 * until their campaign is stored: garbage collection must not delete them first.
 */
function deps(client: GistApi, written: string[] = []): SyncDeps {
  return {
    api: client,
    readAsset: async (id) => (await getAssetBlob(id)) ?? null,
    hasAsset: async (id, hash) => {
      const blob = await getAssetBlob(id)
      if (!blob) return false
      // Ids are random per upload, so a known hash settles it without reading the blob.
      const known = useCampaignStore.getState().campaign?.library.find((a) => a.id === id)
      if (known?.hash === hash) return true
      return hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())) === hash
    },
    writeAsset: async (meta, blob) => {
      pendingUploads.add(meta.id)
      written.push(meta.id)
      await putAsset(meta.id, blob, null)
    },
    sha256Hex: async (bytes) => hex(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))),
  }
}

function release(written: readonly string[]): void {
  for (const id of written) pendingUploads.delete(id)
}

function dirty(campaign: CampaignState, link: GistLink): boolean {
  return campaign.updatedAt > link.syncedUpdatedAt
}

/** The status shown for the open campaign, from the token, the link and unsynced changes. */
function refreshStatus(): void {
  const { token, link, status } = useGistStore.getState()
  if (syncing || status === 'conflict' || status === 'error') return
  const campaign = useCampaignStore.getState().campaign
  if (!token) set({ status: 'off' })
  else if (!link) set({ status: 'unlinked' })
  else if (campaign && dirty(campaign, link)) set({ status: 'unsynced' })
  else set({ status: 'synced' })
}

/** After an error or a resolved conflict: compute the status afresh. */
function clearProblem(): void {
  lastErrorStatus = null
  set({ status: 'synced', error: null })
  refreshStatus()
}

async function loadLink(campaignId: string, at: number): Promise<void> {
  const link = await readGistLink(campaignId).catch(() => null)
  if (!live(at) || useCampaignStore.getState().campaign?.id !== campaignId) return
  linkFor = campaignId
  set({ link })
  clearProblem()
}

/** The open campaign's link: the loaded one, or read now if it is still loading. */
async function linkOf(campaignId: string): Promise<GistLink | null> {
  if (linkFor === campaignId) return useGistStore.getState().link
  return readGistLink(campaignId).catch(() => null)
}

/** Records a campaign's link (in memory too while it is open), unless this tab stopped syncing. */
async function storeLink(campaignId: string, link: GistLink, at: number): Promise<void> {
  if (!live(at)) return
  if (useCampaignStore.getState().campaign?.id === campaignId) {
    linkFor = campaignId
    set({ link })
  }
  await writeGistLink(campaignId, link).catch(() => undefined)
}

/** Starts gist sync for this tab (it holds the DM lock). */
export function startGist(actions: GistSessionActions): void {
  if (running) return
  running = true
  gistEpoch += 1
  const at = gistEpoch
  session = actions
  useGistStore.setState(initialGistState())
  unsubscribe = useCampaignStore.subscribe((state, previous) => {
    const campaign = state.campaign
    if (!campaign) return
    if (campaign.id !== previous.campaign?.id) {
      // Never let the previous campaign's link apply to this one, even briefly.
      linkFor = null
      set({ link: null, error: null })
      clearProblem()
      void loadLink(campaign.id, at)
      return
    }
    if (campaign === previous.campaign) return
    refreshStatus()
    // Scene switches sync too (SPEC §7).
    if (
      campaign.activeSceneId !== previous.campaign?.activeSceneId &&
      useGistStore.getState().link?.autoSync
    ) {
      void syncIfDue(true)
    }
  })
  timer = setInterval(() => void syncIfDue(false), 20_000)
  const open = useCampaignStore.getState().campaign
  if (open) void loadLink(open.id, at)
  void readSavedToken()
    .then((token) => {
      if (!live(at) || !token) return
      const client = createGistApi(token)
      api = client
      set({ token, remember: true })
      refreshStatus()
      // Who the token belongs to. A rejected token shows as an error; being offline does not.
      void client
        .getUser()
        .then(({ login }) => {
          if (live(at)) set({ login })
        })
        .catch((error: unknown) => {
          if (live(at) && error instanceof GitHubError && error.status === 401) failed(error)
        })
    })
    .catch(() => undefined)
}

/** Stops syncing in this tab (another tab took the DM role): it forgets the token too. */
export function stopGist(): void {
  running = false
  gistEpoch += 1
  api = null
  linkFor = null
  syncing = false
  unsubscribe?.()
  unsubscribe = null
  if (timer !== null) clearInterval(timer)
  timer = null
  useGistStore.setState(initialGistState())
}

async function syncIfDue(sceneSwitch: boolean): Promise<void> {
  const { token, link, status } = useGistStore.getState()
  const campaign = useCampaignStore.getState().campaign
  if (!running || syncing || !token || !link?.autoSync || !campaign) return
  // After an error, keep trying (less often), unless GitHub rejected the token.
  const retrying = status === 'error' && lastErrorStatus !== 401 && dirty(campaign, link)
  if (status !== 'unsynced' && !retrying) return
  const minutes = retrying ? Math.max(link.intervalMin, 5) : link.intervalMin
  const due = Date.now() - lastAutoAttempt >= minutes * 60_000
  if (!due && !(sceneSwitch && !retrying)) return
  lastAutoAttempt = Date.now()
  await saveToGist({ auto: true })
}

/** Checks a token with GitHub and keeps it (in this browser too when `remember`). */
export async function connectGist(token: string, remember: boolean): Promise<boolean> {
  const trimmed = token.trim()
  if (trimmed === '' || !running) return false
  const at = gistEpoch
  const client = createGistApi(trimmed)
  let login: string
  try {
    login = (await client.getUser()).login
  } catch (error) {
    notifySticky([`GitHub did not accept the token: ${errorText(error)}`])
    return false
  }
  if (!live(at)) return false
  api = client
  set({ token: trimmed, login, remember })
  clearProblem()
  try {
    if (remember) await saveToken(trimmed)
    else await forgetToken()
    notify(`Connected to GitHub as ${login}.`)
  } catch {
    notifySticky([
      `Connected to GitHub as ${login}, but this browser could not remember the token: you will paste it again next time.`,
    ])
  }
  return true
}

/** Forgets the token (memory and this browser). Campaign links stay, for reconnecting. */
export async function disconnectGist(): Promise<void> {
  api = null
  lastErrorStatus = null
  set({ token: null, login: null, error: null, status: 'off' })
  await forgetToken().catch(() => undefined)
  refreshStatus()
}

function needToken(): GistApi | null {
  if (api && useGistStore.getState().token) return api
  useUiStore.setState({ dialog: 'settings' })
  notify('Connect to GitHub first (Settings, Sync with a GitHub Gist).')
  return null
}

function reportPush(campaignId: string, result: PushResult, auto: boolean): void {
  const skipped = result.skippedAssets.length
  const key = result.skippedAssets.map((asset) => asset.id).join(',')
  const changed = reportedSkipped.get(campaignId) !== key
  reportedSkipped.set(campaignId, key)
  const text = `${skipped} ${skipped === 1 ? 'image stays' : 'images stay'} on this device only (too large for a gist, or missing here): keep a backup for those.`
  if (auto) {
    // Automatic saves say it once, when the set of such images changes.
    if (skipped > 0 && changed) notifySticky([`Saved to the gist. ${text}`])
  } else {
    notify(skipped > 0 ? `Saved to the gist. ${text}` : 'Saved to the gist.')
  }
}

/** Saves the open campaign to its gist, creating a secret gist the first time. */
export async function saveToGist(options: { auto?: boolean; force?: boolean } = {}): Promise<void> {
  const client = options.auto ? api : needToken()
  if (!client || syncing || !running) return
  const at = gistEpoch
  syncing = true
  set({ status: 'syncing', error: null, progress: { phase: 'checking', done: 0, total: 0 } })
  try {
    await session?.flushSave().catch(() => undefined) // the gist gets the campaign as it is in memory
    const campaign = getCampaign()
    const link = await linkOf(campaign.id)
    const settings = {
      autoSync: link?.autoSync ?? true,
      intervalMin: link?.intervalMin ?? DEFAULT_AUTO_SYNC_MINUTES,
    }
    const result = await pushCampaign(
      deps(client),
      campaign,
      { gistId: link?.gistId ?? null, lastSyncedSha: link?.lastSyncedSha ?? null },
      {
        force: options.force === true,
        onProgress: (progress) => {
          if (live(at)) set({ progress })
        },
        // Every commit is remembered at once: an interrupted save resumes in the same
        // gist, and the next attempt does not mistake its own commits for a conflict.
        onCommit: (committed) => {
          void storeLink(
            campaign.id,
            {
              gistId: committed.gistId,
              lastSyncedSha: committed.lastSyncedSha,
              syncedUpdatedAt: link?.syncedUpdatedAt ?? 0,
              ...settings,
            },
            at,
          )
        },
      },
    )
    await storeLink(
      campaign.id,
      {
        gistId: result.gistId,
        lastSyncedSha: result.sha,
        syncedUpdatedAt: campaign.updatedAt,
        ...settings,
      },
      at,
    )
    if (!live(at)) return
    syncing = false
    clearProblem()
    reportPush(campaign.id, result, options.auto === true)
  } catch (error) {
    if (!live(at)) return
    syncing = false
    if (error instanceof ConflictError) {
      set({ status: 'conflict', error: 'The gist was changed from another device.' })
      if (!options.auto) await resolveConflict()
    } else {
      failed(error)
      if (!options.auto) notifySticky([`Saving to the gist failed: ${errorText(error)}`])
    }
  } finally {
    if (live(at)) {
      syncing = false
      set({ progress: null })
    }
  }
}

/** The DM's choice when the gist changed elsewhere (SPEC §7 "Conflicts"). */
export async function resolveConflict(): Promise<void> {
  const choice = await chooseAction({
    title: 'The gist changed on another device',
    message:
      'Since this device last synced, the gist was saved from somewhere else. Overwrite it with this campaign, load the gist here (this campaign’s unsaved-to-gist changes are lost), or keep a local copy of this campaign first and then load the gist.',
    choices: [
      { id: 'copy', label: 'Keep a copy, then load', tone: 'plain' },
      { id: 'load', label: 'Load the gist', tone: 'plain' },
      { id: 'overwrite', label: 'Overwrite the gist', tone: 'danger' },
    ],
  })
  if (choice === null) return
  if (choice === 'overwrite') {
    clearProblem()
    await saveToGist({ force: true })
    return
  }
  if (choice === 'copy') {
    // Never load over the campaign unless its copy really exists.
    const copied = (await session?.duplicateCampaign(getCampaign().id)) === true
    if (!copied) return
  }
  clearProblem()
  await loadFromGist({ confirmed: true })
}

/** Migrates and validates a pulled campaign; a SyncError explains a bad one. */
function validPulled(raw: unknown): CampaignState {
  try {
    return validateCampaign(migrateToCurrent(raw)).campaign
  } catch (error) {
    throw new SyncError(`The gist's campaign could not be read: ${errorText(error)}`)
  }
}

/** Says which images of a pulled campaign this device lacks (damaged, or never synced). */
async function reportMissing(
  campaign: CampaignState,
  missing: readonly string[],
): Promise<boolean> {
  const localOnly: string[] = []
  for (const asset of campaign.library) {
    if (asset.localOnly && !(await getAssetBlob(asset.id))) localOnly.push(asset.id)
  }
  const lines: string[] = []
  if (missing.length > 0) {
    lines.push(
      `${missing.length} ${missing.length === 1 ? 'image' : 'images'} could not be downloaded from the gist (missing or damaged).`,
    )
  }
  if (localOnly.length > 0) {
    lines.push(
      `${localOnly.length} ${localOnly.length === 1 ? 'image is' : 'images are'} too large for a gist and only on the device that uploaded them: bring them over with a backup.`,
    )
  }
  if (lines.length > 0) notifySticky(lines)
  return lines.length > 0
}

/**
 * Replaces the open campaign with its gist: the latest version, or an earlier
 * one (`revision`, from the history). An earlier version comes back as unsynced,
 * so the next save makes it the gist's latest version.
 */
export async function loadFromGist(
  options: { revision?: string; confirmed?: boolean } = {},
): Promise<void> {
  const client = needToken()
  if (!client || syncing || !running) return
  const at = gistEpoch
  const local = getCampaign()
  const link = await linkOf(local.id)
  if (!link) return
  if (!options.confirmed && (dirty(local, link) || options.revision)) {
    const ok = await confirmAction({
      title: options.revision ? 'Restore this version?' : 'Load the gist here?',
      message: `This replaces “${local.name}” on this device. Changes not saved to the gist are lost.`,
      confirmLabel: options.revision ? 'Restore' : 'Load',
    })
    if (!ok || !live(at)) return
  }
  syncing = true
  set({ status: 'syncing', error: null })
  const written: string[] = []
  try {
    const result = await pullCampaign(deps(client, written), link.gistId, {
      revision: options.revision,
    })
    // The link belongs to this local campaign: keep its id whatever the gist says.
    const campaign = { ...validPulled(result.campaign), id: local.id }
    const latest = options.revision
      ? await client.latestCommitSha(link.gistId).catch(() => link.lastSyncedSha)
      : result.sha
    if (!live(at)) return
    syncing = false
    if (!(await session?.adoptCampaign(campaign))) {
      refreshStatus()
      return
    }
    await storeLink(
      campaign.id,
      {
        ...link,
        lastSyncedSha: latest,
        // A restored version differs from the gist's latest: it shows as unsynced.
        syncedUpdatedAt: options.revision ? 0 : campaign.updatedAt,
      },
      at,
    )
    clearProblem()
    const warned = await reportMissing(campaign, result.missingAssets)
    if (!warned) {
      notify(
        options.revision
          ? 'Earlier version restored. Save to make it the gist’s latest.'
          : 'Loaded from the gist.',
      )
    }
  } catch (error) {
    if (!live(at)) return
    syncing = false
    failed(error)
    notifySticky([`Loading from the gist failed: ${errorText(error)}`])
  } finally {
    release(written)
    if (live(at)) syncing = false
  }
}

/** A gist id from what the DM pasted: an id, or a gist URL. */
export function parseGistId(input: string): string | null {
  const text = input.trim()
  if (/^[0-9a-f]{20,40}$/i.test(text)) return text
  const match = /gist\.github(?:usercontent)?\.com\/(?:[^/\s]+\/)?([0-9a-f]{20,40})/i.exec(text)
  return match?.[1] ?? null
}

/** The DM's campaign gists (those with a VTT manifest). Errors are thrown for the caller to show. */
export async function listCampaignGists(): Promise<GistSummary[]> {
  const client = needToken()
  if (!client) return []
  const gists = await client.listGists()
  return gists.filter(isVttGist)
}

/**
 * Opens a gist on this device ("Open existing gist"): its campaign becomes a
 * local campaign linked to it. If the same campaign is already here the DM
 * chooses to replace it or to import a copy (which is not linked).
 */
export async function openGist(input: string): Promise<boolean> {
  const client = needToken()
  if (!client || syncing || !running) return false
  const at = gistEpoch
  const gistId = parseGistId(input)
  if (!gistId) {
    notifySticky([
      'That is not a gist link or id. Paste the gist’s address, for example https://gist.github.com/you/1a2b3c…',
    ])
    return false
  }
  syncing = true
  const written: string[] = []
  try {
    const result = await pullCampaign(deps(client, written), gistId)
    let campaign = validPulled(result.campaign)
    syncing = false
    let linked = true
    const existing = useSessionStore.getState().campaigns.find((c) => c.id === campaign.id)
    if (existing) {
      const choice = await chooseAction({
        title: `“${existing.name}” is already on this device`,
        message:
          'Replace it with the gist’s version, or import the gist as a separate copy? Replacing loses changes not saved to the gist.',
        choices: [
          { id: 'copy', label: 'Import as a copy', tone: 'plain' },
          { id: 'replace', label: 'Replace', tone: 'danger' },
        ],
      })
      if (choice === null) return false
      if (choice === 'copy') {
        linked = false
        const now = Date.now()
        campaign = {
          ...campaign,
          id: newId(),
          name: `${campaign.name} (from gist)`.slice(0, MAX_NAME_LENGTH),
          createdAt: now,
          updatedAt: now,
        }
      }
    }
    if (!live(at) || !(await session?.adoptCampaign(campaign))) return false
    if (linked) {
      await storeLink(
        campaign.id,
        {
          gistId,
          lastSyncedSha: result.sha,
          syncedUpdatedAt: campaign.updatedAt,
          autoSync: true,
          intervalMin: DEFAULT_AUTO_SYNC_MINUTES,
        },
        at,
      )
    }
    clearProblem()
    const warned = await reportMissing(campaign, result.missingAssets)
    if (!warned) notify(`Opened “${campaign.name}” from the gist.`)
    return true
  } catch (error) {
    if (live(at)) notifySticky([`The gist could not be opened: ${errorText(error)}`])
    return false
  } finally {
    release(written)
    if (live(at)) syncing = false
  }
}

/**
 * A campaign replaced from outside the gist (a backup import): if it is linked,
 * it now differs from the gist, so it shows as unsynced and the next save pushes it.
 */
export async function markReplaced(campaignId: string): Promise<void> {
  const link = await readGistLink(campaignId).catch(() => null)
  if (!link) return
  await storeLink(campaignId, { ...link, syncedUpdatedAt: 0 }, gistEpoch)
  refreshStatus()
}

/** The gist's history (newest first), for "Restore an earlier version". */
export async function gistHistory(page = 1): Promise<GistCommit[]> {
  const client = needToken()
  const { link } = useGistStore.getState()
  if (!client || !link) return []
  return client.listCommits(link.gistId, page)
}

export async function setAutoSync(autoSync: boolean, intervalMin: number): Promise<void> {
  const { link } = useGistStore.getState()
  const campaign = useCampaignStore.getState().campaign
  if (!link || !campaign) return
  await storeLink(campaign.id, { ...link, autoSync, intervalMin }, gistEpoch)
}

/** Stops syncing this campaign with its gist (the gist itself is kept on GitHub). */
export async function unlinkGist(): Promise<void> {
  const campaign = useCampaignStore.getState().campaign
  if (!campaign) return
  await removeGistLink(campaign.id).catch(() => undefined)
  set({ link: null, error: null, status: 'unlinked' })
  refreshStatus()
}
