import { CloudAlert, CloudCheck, CloudUpload, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useGistStore } from '../store/gist'
import { useUiStore } from '../store/ui'
import { resolveConflict } from './gist'

function openSettings(): void {
  useUiStore.setState({ dialog: 'settings' })
}

/**
 * The gist status in the header (SPEC §7 "Status indicator"): synced, unsynced
 * changes, syncing (with progress), error, or a conflict to resolve. Hidden
 * while the campaign has no gist.
 */
export function GistIndicator() {
  const status = useGistStore((s) => s.status)
  const error = useGistStore((s) => s.error)
  const linked = useGistStore((s) => s.link !== null)
  const progress = useGistStore((s) => s.progress)
  if (!linked && status !== 'syncing' && status !== 'error') return null
  const base =
    'flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs whitespace-nowrap hover:bg-surface-3'
  switch (status) {
    case 'syncing':
      return (
        <span role="status" className={`${base} text-fg-muted`}>
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          {progress?.phase === 'assets' && progress.total > 0
            ? `Gist: images ${progress.done}/${progress.total}`
            : 'Gist: saving…'}
        </span>
      )
    case 'conflict':
      return (
        <button
          type="button"
          onClick={() => void resolveConflict()}
          className={`${base} text-danger`}
          title="The gist was changed from another device. Click to choose which version wins."
        >
          <TriangleAlert aria-hidden className="size-4" />
          Gist changed elsewhere
        </button>
      )
    case 'error':
      return (
        <button
          type="button"
          onClick={openSettings}
          className={`${base} text-danger`}
          title={`${error ?? 'Syncing with the gist failed.'} Click for the sync settings.`}
        >
          <CloudAlert aria-hidden className="size-4" />
          Gist error
        </button>
      )
    case 'unsynced':
      return (
        <button
          type="button"
          onClick={openSettings}
          className={`${base} text-fg-muted`}
          title="Changes not yet saved to the gist"
        >
          <CloudUpload aria-hidden className="size-4" />
          Gist: unsynced
        </button>
      )
    case 'synced':
      return (
        <button
          type="button"
          onClick={openSettings}
          className={`${base} text-fg-muted`}
          title="Saved to the gist"
        >
          <CloudCheck aria-hidden className="size-4 text-ok" />
          Gist: synced
        </button>
      )
    default:
      return (
        <button
          type="button"
          onClick={openSettings}
          className={`${base} text-fg-muted`}
          title="Connect to GitHub to sync this campaign"
        >
          <CloudAlert aria-hidden className="size-4" />
          Gist: not connected
        </button>
      )
  }
}
