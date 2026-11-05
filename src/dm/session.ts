import { DM_LOCK } from '../sync/protocol'
import { createAutosaver, type Autosaver, type SaveStatus } from '../persistence/autosave'
import {
  collectAssetGarbage,
  getLastCampaignId,
  isQuotaError,
  listCampaigns,
  readCampaign,
  removeCampaign,
  setLastCampaignId,
  writeCampaign,
} from '../persistence/db'
import { removeGistLink } from '../persistence/gistLinks'
import { createCampaign } from '../state/defaults'
import { newId } from '../state/ids'
import { migrateToCurrent } from '../state/migrations'
import type { CampaignState } from '../state/types'
import { MAX_NAME_LENGTH, validateCampaign } from '../state/validate'
import {
  commit,
  getCampaign,
  loadCampaign,
  unloadCampaign,
  useCampaignStore,
} from '../store/campaign'
import { loadDevicePrefs } from '../store/devicePrefs'
import { useSessionStore, type SessionState } from '../store/session'
import { notify, notifySticky, resetUiForCampaign, sceneSwitched } from '../store/ui'
import { pendingUploads } from './pendingUploads'
import { startGist, stopGist } from './gist'
import { startPresentation, stopPresentation } from './presentation'

/**
 * The DM session: one editing window, autosave, and local campaigns (SPEC §6).
 *
 * - Only the tab holding the Web Lock `vtt:dm` loads, edits and saves a
 *   campaign. A second DM tab shows "open in another tab" and can take over:
 *   it asks the holder (BroadcastChannel `vtt-dm`, which carries no campaign
 *   data) to save and release the lock, and steals it if the holder does not
 *   answer within 3 s.
 * - Autosave writes the campaign 1 s after the last change and when the page is
 *   hidden; closing or reloading with unsaved changes asks "Leave site?".
 * - Every load runs migrateToCurrent + validateCampaign.
 * - Losing the lock (handover or steal) bumps `epoch`: every asynchronous
 *   session step re-checks it after each await, so a tab that lost the lock
 *   mid-load can never show a campaign or start saving it.
 *
 * Started once per page by DmApp; it lives as long as the page.
 */

const LOCK_NAME = DM_LOCK
const CHANNEL_NAME = 'vtt-dm'
const TAKEOVER_TIMEOUT_MS = 3000
const RELOAD_GRACE_MS = 1000

type ChannelMessage =
  | { type: 'release-request' }
  /** Sent by the old holder just before it releases the lock. */
  | { type: 'handed-over'; unsavedChanges: boolean }

let started = false
let autosaver: Autosaver<CampaignState> | null = null
/** Releases the DM lock; set while this tab holds it. */
let releaseLock: (() => void) | null = null
/** True while this tab may edit and save (it holds the lock, or the browser has no Web Locks). */
let holding = false
/** Bumped whenever this tab stops holding the lock; async steps started before it give up. */
let epoch = 0
let channel: BroadcastChannel | null = null
let persistenceRequested = false
/** The previous holder handed over without managing to save its last changes. */
let handoverLostChanges = false

function setSession(patch: Partial<SessionState>): void {
  useSessionStore.setState(patch)
}

function current(at: number): boolean {
  return holding && at === epoch
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function saveErrorMessage(error: unknown): string {
  if (isQuotaError(error)) {
    return (
      'Browser storage is full, so recent changes are not saved. Export a backup (Campaigns) ' +
      'or save to a gist (Settings) first, then free space by deleting unused images or ' +
      'other campaigns.'
    )
  }
  return `Saving failed: ${errorMessage(error)}`
}

function post(message: ChannelMessage): void {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel has no target origin
  channel?.postMessage(message)
}

// --- Saving -----------------------------------------------------------------------

async function requestPersistence(): Promise<void> {
  if (persistenceRequested || !navigator.storage?.persist) return
  persistenceRequested = true
  try {
    const persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist())
    setSession({ persisted })
  } catch {
    setSession({ persisted: false })
  }
}

async function save(campaign: CampaignState): Promise<void> {
  if (!holding) throw new Error('Another tab is editing this campaign now.')
  await writeCampaign(campaign)
  void requestPersistence()
}

/** The current run of failed saves has already shown its message. */
let saveErrorShown = false

function onSaveStatus(status: SaveStatus, error: unknown): void {
  const message = status === 'error' ? saveErrorMessage(error) : null
  setSession({ saveStatus: status, saveError: message })
  if (status === 'saved') saveErrorShown = false
  // The first failure gets a message that stays; the indicator stays red until a save works.
  if (message && !saveErrorShown) {
    saveErrorShown = true
    notifySticky([message])
  }
}

function startAutosave(): void {
  autosaver?.dispose()
  autosaver = useSessionStore.getState().storageUnavailable
    ? null
    : createAutosaver({ save, onStatus: onSaveStatus })
  saveErrorShown = false
  setSession({ saveStatus: 'saved', saveError: null })
}

function stopAutosave(): void {
  autosaver?.dispose()
  autosaver = null
}

/** Saves pending changes now. Rejects if saving fails. */
export async function flushSave(): Promise<void> {
  await autosaver?.flush()
}

export function retrySave(): void {
  autosaver?.retry()
}

function flushQuietly(): void {
  autosaver?.flush().catch(() => undefined) // shown by the save indicator
}

/**
 * Deletes blobs that no campaign uses. The open campaign counts with its
 * in-memory library (its stored record may be stale, e.g. when saving failed
 * for lack of space), plus uploads in flight.
 */
export async function collectGarbage(): Promise<void> {
  if (!holding || useSessionStore.getState().storageUnavailable) return
  const open = useCampaignStore.getState().campaign
  await collectAssetGarbage(open?.id ?? null, () => [
    ...(useCampaignStore.getState().campaign?.library ?? []).map((asset) => asset.id),
    ...pendingUploads,
  ])
}

// --- Campaigns ----------------------------------------------------------------------

export async function refreshCampaigns(): Promise<void> {
  if (useSessionStore.getState().storageUnavailable) return
  setSession({ campaigns: await listCampaigns() })
}

/** Reads, migrates and validates a stored campaign. Throws a user-facing error. */
async function readValidCampaign(id: string): Promise<CampaignState> {
  const raw = await readCampaign(id)
  if (raw === undefined) throw new Error('This campaign is no longer stored in this browser.')
  return validateCampaign(migrateToCurrent(raw)).campaign
}

/**
 * Shows a campaign and starts saving it, unless this tab lost the lock since `at`.
 * Replacing one campaign with another while a player window is connected turns
 * blackout on first, so players never see a campaign the DM has not shown yet.
 */
function showCampaign(campaign: CampaignState, at: number): boolean {
  if (!current(at)) return false
  const replacing = useCampaignStore.getState().campaign !== null
  const players = useSessionStore.getState().players > 0
  if (replacing && players && !campaign.presentation.blackout) {
    campaign = { ...campaign, presentation: { ...campaign.presentation, blackout: true } }
    notify('Blackout is on while you change campaign. Lift it when players should see it.')
  }
  loadCampaign(campaign)
  resetUiForCampaign()
  startAutosave()
  setSession({ phase: 'ready', failure: null })
  if (!useSessionStore.getState().storageUnavailable) {
    setLastCampaignId(campaign.id).catch(() => undefined)
  }
  return true
}

/** Saves the open campaign before replacing it; false (with a notice) if that failed. */
async function saveBeforeLeaving(): Promise<boolean> {
  try {
    await flushSave()
    return true
  } catch (error) {
    notify(`The current campaign could not be saved, so it stays open. ${saveErrorMessage(error)}`)
    return false
  }
}

/** A new campaign, stored at once. If storing fails it still opens; autosave retries and shows the error. */
async function showNewCampaign(at: number): Promise<void> {
  const campaign = createCampaign()
  if (!useSessionStore.getState().storageUnavailable) {
    try {
      await writeCampaign(campaign)
    } catch (error) {
      if (!current(at)) return
      showCampaign(campaign, at)
      autosaver?.schedule(campaign)
      notifySticky([`The new campaign could not be saved yet. ${saveErrorMessage(error)}`])
      return
    }
  }
  showCampaign(campaign, at)
}

export async function newCampaign(): Promise<void> {
  const at = epoch
  if (!(await saveBeforeLeaving()) || !current(at)) return
  await showNewCampaign(at)
  await refreshCampaigns().catch(() => undefined)
}

export async function openCampaign(id: string): Promise<void> {
  const at = epoch
  const open = useCampaignStore.getState().campaign
  if (open?.id === id) return
  if (open && !(await saveBeforeLeaving())) return
  try {
    const campaign = await readValidCampaign(id)
    showCampaign(campaign, at)
  } catch (error) {
    if (!current(at)) return
    if (open) {
      notify(`That campaign could not be opened: ${errorMessage(error)}`)
    } else {
      unloadCampaign()
      setSession({ phase: 'failed', failure: { campaignId: id, message: errorMessage(error) } })
    }
  }
  await refreshCampaigns().catch(() => undefined)
}

/** Duplicates a stored campaign; true when the copy was stored. */
export async function duplicateCampaign(id: string): Promise<boolean> {
  const open = useCampaignStore.getState().campaign
  if (open?.id === id && !(await saveBeforeLeaving())) return false
  try {
    const source = await readValidCampaign(id)
    const now = Date.now()
    const copy: CampaignState = {
      ...source,
      id: newId(),
      name: `${source.name} (copy)`.slice(0, MAX_NAME_LENGTH),
      createdAt: now,
      updatedAt: now,
    }
    await writeCampaign(copy)
    notify(`Created ${copy.name}.`)
    await refreshCampaigns().catch(() => undefined)
    return true
  } catch (error) {
    notify(`The campaign could not be duplicated: ${errorMessage(error)}`)
    await refreshCampaigns().catch(() => undefined)
    return false
  }
}

/**
 * Stores and opens a campaign that came from outside this device (a backup or a
 * gist), already migrated and validated. A different open campaign is saved
 * first; when the incoming one replaces the open campaign (same id, the DM chose
 * to overwrite it), its pending save is written first and then superseded, so an
 * old save can never land after the new version. False if it was not stored or
 * the tab lost the lock meanwhile.
 */
export async function adoptCampaign(campaign: CampaignState): Promise<boolean> {
  const at = epoch
  const open = useCampaignStore.getState().campaign
  const replacing = open?.id === campaign.id
  if (open && !replacing && !(await saveBeforeLeaving())) return false
  if (replacing) {
    await flushSave().catch(() => undefined)
    stopAutosave()
  }
  // A tab that lost the lock meanwhile must not overwrite what the new tab edits.
  if (!current(at)) return false
  try {
    if (!useSessionStore.getState().storageUnavailable) await writeCampaign(campaign)
  } catch (error) {
    if (replacing && current(at)) startAutosave()
    notifySticky([`The campaign could not be stored. ${saveErrorMessage(error)}`])
    return false
  }
  if (!current(at)) return false
  showCampaign(campaign, at)
  await refreshCampaigns().catch(() => undefined)
  return true
}

/**
 * Deletes a stored campaign (after the caller's confirmation). Deleting the open
 * one opens the most recent other campaign, or a new one; the store never goes
 * empty, so open dialogs keep rendering.
 */
export async function deleteCampaign(id: string): Promise<void> {
  const at = epoch
  const deletingOpen = useCampaignStore.getState().campaign?.id === id
  try {
    if (deletingOpen) stopAutosave()
    await removeCampaign(id)
    // Its gist link would otherwise come back with a re-imported copy.
    await removeGistLink(id).catch(() => undefined)
    await refreshCampaigns()
    if (!current(at)) return
    if (deletingOpen || useSessionStore.getState().phase === 'failed') {
      const next = useSessionStore.getState().campaigns[0]
      const replacement = next ? await readValidCampaign(next.id).catch(() => null) : null
      if (replacement) showCampaign(replacement, at)
      else await showNewCampaign(at)
      await refreshCampaigns()
    }
    await collectGarbage()
  } catch (error) {
    notify(`The campaign could not be deleted: ${errorMessage(error)}`)
    // Never leave the open campaign without autosave.
    if (deletingOpen && current(at) && !autosaver) startAutosave()
  }
}

export function renameCampaign(name: string): void {
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH)
  if (trimmed === '' || trimmed === getCampaign().name) return
  // `name` is a recorded key, so renaming is undoable.
  commit(`Rename campaign to ${trimmed}`, (draft) => {
    draft.name = trimmed
  })
}

/** Opens the last campaign, the most recent one, or a new one. */
async function openInitialCampaign(at: number): Promise<void> {
  let lastId: string | null
  try {
    lastId = await getLastCampaignId()
    await refreshCampaigns()
  } catch {
    // IndexedDB is unavailable (blocked, or a broken profile): work in memory.
    setSession({ storageUnavailable: true })
    showCampaign(createCampaign(), at)
    return
  }
  if (!current(at)) return
  const { campaigns } = useSessionStore.getState()
  const id = campaigns.some((c) => c.id === lastId) ? lastId : (campaigns[0]?.id ?? null)
  if (id) await openCampaign(id)
  else await showNewCampaign(at)
  if (!current(at)) return
  if (handoverLostChanges && useSessionStore.getState().phase === 'ready') {
    notifySticky([
      'The other tab could not save its last changes before handing over, so they are missing here.',
    ])
  }
  handoverLostChanges = false
  await collectGarbage().catch(() => undefined)
}

// --- The DM lock --------------------------------------------------------------------

/** This tab stops editing: no more saves, and pending async steps give up. */
function stepAside(): void {
  holding = false
  epoch += 1
  releaseLock = null
  stopPresentation()
  stopGist()
  stopAutosave()
  unloadCampaign()
  setSession({ phase: 'inactive', inactiveReason: 'taken-over' })
}

/** Another tab asked for the lock: save, then release it. */
async function handOver(): Promise<void> {
  const release = releaseLock
  if (!release || !holding) return
  let unsavedChanges = false
  try {
    await autosaver?.flush()
  } catch {
    unsavedChanges = useSessionStore.getState().saveStatus !== 'saved'
  }
  if (releaseLock !== release) return // stolen meanwhile
  stepAside()
  post({ type: 'handed-over', unsavedChanges })
  release()
}

/** Requests the lock; resolves true once held, false if `ifAvailable` and it is taken. */
function requestLock(options: LockOptions): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let granted = false
    navigator.locks
      .request(LOCK_NAME, options, (lock) => {
        if (!lock) {
          resolve(false)
          return undefined
        }
        granted = true
        holding = true
        resolve(true)
        return new Promise<void>((release) => {
          releaseLock = release
        })
      })
      .catch((error: unknown) => {
        // Stolen by another tab (AbortError) after we held it.
        if (granted) {
          if (holding) stepAside()
        } else {
          reject(error)
        }
      })
  })
}

async function acquireLock(stealing: boolean): Promise<boolean> {
  if (!('locks' in navigator)) {
    holding = true
    return true
  }
  if (!stealing) {
    if (await requestLock({ ifAvailable: true })) return true
    // After a reload the previous page may not have released the lock yet: wait a moment.
    try {
      return await requestLock({ signal: AbortSignal.timeout(RELOAD_GRACE_MS) })
    } catch {
      return false
    }
  }
  handoverLostChanges = false
  post({ type: 'release-request' })
  try {
    return await requestLock({ signal: AbortSignal.timeout(TAKEOVER_TIMEOUT_MS) })
  } catch {
    return requestLock({ steal: true })
  }
}

async function claim(stealing: boolean): Promise<void> {
  setSession({ phase: 'starting' })
  try {
    if (!(await acquireLock(stealing))) {
      setSession({ phase: 'inactive', inactiveReason: 'open-elsewhere' })
      return
    }
    // Player windows follow whichever tab holds the DM lock.
    startPresentation()
    startGist({ adoptCampaign, duplicateCampaign, flushSave })
    await openInitialCampaign(epoch)
  } catch (error) {
    unloadCampaign()
    setSession({ phase: 'failed', failure: { campaignId: null, message: errorMessage(error) } })
  }
}

/** "Use this tab instead": takes the DM lock from the other tab. */
export function takeOver(): void {
  void claim(true)
}

function onChannelMessage(event: MessageEvent<unknown>): void {
  const data = event.data
  if (typeof data !== 'object' || data === null || !('type' in data)) return
  if (data.type === 'release-request') void handOver()
  if (data.type === 'handed-over' && 'unsavedChanges' in data && data.unsavedChanges === true) {
    handoverLostChanges = true
  }
}

/** Starts the session once per page (React StrictMode may call it twice). */
export function startSession(): void {
  if (started) return
  started = true
  loadDevicePrefs()
  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.addEventListener('message', onChannelMessage)
  }
  window.addEventListener('pagehide', flushQuietly)
  // A write started while the page unloads is aborted, so unsaved changes get the
  // browser's "Leave site?" prompt (only in the second after an edit, or after a failed save).
  window.addEventListener('beforeunload', (event) => {
    if (!autosaver || useSessionStore.getState().saveStatus === 'saved') return
    flushQuietly()
    event.preventDefault()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushQuietly()
  })
  useCampaignStore.subscribe((state, previous) => {
    const next = state.campaign
    const before = previous.campaign
    // A newly loaded campaign is already stored; only edits of the same campaign are saved.
    if (!next || !before || next === before || next.id !== before.id) return
    autosaver?.schedule(next)
    if (next.activeSceneId !== before.activeSceneId) {
      sceneSwitched(before.activeSceneId, next.activeSceneId)
    }
  })
  void claim(false)
}
