/**
 * Debounced autosave (SPEC §6): saves the latest value `delayMs` after the last
 * change, one save at a time, and reports its status for the "saved" indicator.
 * A failed save keeps the value pending and the status 'error' until a save
 * succeeds; the next change, `flush` or `retry` tries again. Pure scheduling logic: the caller supplies `save`.
 */
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error'

export interface AutosaverOptions<T> {
  save: (value: T) => Promise<void>
  onStatus: (status: SaveStatus, error: unknown) => void
  delayMs?: number
}

export interface Autosaver<T> {
  /** A new value to save; restarts the debounce timer. */
  schedule: (value: T) => void
  /** Saves any pending value now and waits for every save in flight. Rejects if the save fails. */
  flush: () => Promise<void>
  /** Retries a failed save now. */
  retry: () => void
  /** Stops: pending values are dropped and later calls do nothing. */
  dispose: () => void
}

export const AUTOSAVE_DELAY_MS = 1000

export function createAutosaver<T>({
  save,
  onStatus,
  delayMs = AUTOSAVE_DELAY_MS,
}: AutosaverOptions<T>): Autosaver<T> {
  let pending: { value: T } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<void> | null = null
  let disposed = false
  /** The last save failed: the status stays 'error' (not 'pending') until a save succeeds. */
  let failure: { error: unknown } | null = null

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  /** Saves the pending value (after any save in flight). Resolves when it is stored. */
  const run = (): Promise<void> => {
    if (inFlight) return inFlight.then(run, run)
    if (!pending || disposed) return Promise.resolve()
    const { value } = pending
    pending = null
    onStatus('saving', null)
    const attempt = save(value).then(
      () => {
        if (inFlight === attempt) inFlight = null
        failure = null
        if (!disposed) onStatus(pending || timer !== null ? 'pending' : 'saved', null)
      },
      (error: unknown) => {
        if (inFlight === attempt) inFlight = null
        // Keep the value unless a newer one arrived meanwhile.
        pending ??= { value }
        failure = { error }
        if (!disposed) onStatus('error', error)
        throw error
      },
    )
    inFlight = attempt
    return attempt
  }

  const fire = () => {
    timer = null
    run().catch(() => undefined) // reported through onStatus
  }

  return {
    schedule(value) {
      if (disposed) return
      pending = { value }
      clearTimer()
      timer = setTimeout(fire, delayMs)
      if (!inFlight) {
        if (failure) onStatus('error', failure.error)
        else onStatus('pending', null)
      }
    },
    flush() {
      clearTimer()
      return run()
    },
    retry() {
      clearTimer()
      run().catch(() => undefined)
    },
    dispose() {
      disposed = true
      pending = null
      clearTimer()
    },
  }
}
