import { CircleAlert, CircleCheck, CloudOff, LoaderCircle, PencilLine } from 'lucide-react'
import { useSessionStore } from '../store/session'
import { retrySave } from './session'

/**
 * The autosave indicator in the header (SPEC §6): saved, unsaved, saving, or
 * error with retry. The error state stays until a save succeeds.
 */
export function SaveIndicator() {
  const status = useSessionStore((s) => s.saveStatus)
  const error = useSessionStore((s) => s.saveError)
  const unavailable = useSessionStore((s) => s.storageUnavailable)

  const base = 'flex items-center gap-1.5 text-xs whitespace-nowrap'
  let content
  if (unavailable) {
    content = (
      <span
        className={`${base} text-danger`}
        title="This browser does not allow saving (storage is blocked or unavailable). Changes are lost on reload."
      >
        <CloudOff aria-hidden className="size-4" />
        Not saving
      </span>
    )
  } else if (status === 'error') {
    content = (
      <button
        type="button"
        onClick={retrySave}
        className={`${base} rounded-md px-1.5 py-1 text-danger hover:bg-surface-3`}
        title={`${error ?? 'Saving failed.'} Click to try again.`}
      >
        <CircleAlert aria-hidden className="size-4" />
        Not saved, retry
      </button>
    )
  } else if (status === 'saving') {
    content = (
      <span className={`${base} text-fg-muted`}>
        <LoaderCircle aria-hidden className="size-4 animate-spin" />
        Saving…
      </span>
    )
  } else if (status === 'pending') {
    content = (
      <span className={`${base} text-fg-muted`}>
        <PencilLine aria-hidden className="size-4" />
        Unsaved changes
      </span>
    )
  } else {
    content = (
      <span className={`${base} text-fg-muted`} title="Saved in this browser">
        <CircleCheck aria-hidden className="size-4 text-ok" />
        Saved
      </span>
    )
  }
  // Routine states are not announced (they change on every edit); failures are, as alerts.
  return (
    <div
      data-testid="save-status"
      role={status === 'error' || unavailable ? 'alert' : undefined}
      className="flex items-center"
    >
      {content}
    </div>
  )
}
