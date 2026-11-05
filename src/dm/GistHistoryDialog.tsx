import { useEffect, useState } from 'react'
import type { GistCommit } from '../gist/api'
import { useUiStore } from '../store/ui'
import { buttonClass } from '../ui/controls'
import { Dialog } from '../ui/Dialog'
import { gistHistory, loadFromGist } from './gist'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function close() {
  useUiStore.setState({ dialog: null })
}

/**
 * "Restore an earlier version" (SPEC §7): the gist's history, newest first. A
 * version is loaded only when chosen; one saved halfway through an upload has
 * no campaign and says so then.
 */
export function GistHistoryDialog() {
  const [commits, setCommits] = useState<GistCommit[] | null>(null)
  const [page, setPage] = useState(1)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    gistHistory(page)
      .then((next) => {
        if (!live) return
        setCommits((current) => [...(page === 1 ? [] : (current ?? [])), ...next])
        setMore(next.length === 30)
      })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      live = false
    }
  }, [page])

  return (
    <Dialog title="Restore an earlier version" onClose={close}>
      <div className="space-y-3">
        <p className="text-xs text-fg-muted">
          Every save to the gist is kept by GitHub. Restoring replaces the campaign on this device;
          save to the gist afterwards to make it the latest version there too.
        </p>
        {error && <p className="text-sm text-danger">{error}</p>}
        {commits === null && !error && <p className="text-sm text-fg-muted">Loading…</p>}
        {commits && (
          <ol
            aria-label="Versions"
            className="divide-y divide-border rounded-lg border border-border"
          >
            {commits.map((commit, index) => (
              <li key={commit.sha} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1">
                  {dateFormat.format(new Date(commit.committedAt))}
                  {index === 0 && <span className="ml-2 text-xs text-accent">latest</span>}
                </span>
                <span className="text-xs text-fg-muted">
                  {commit.changes} {commit.changes === 1 ? 'change' : 'changes'}
                </span>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => {
                    close()
                    void loadFromGist({ revision: commit.sha })
                  }}
                >
                  Restore
                </button>
              </li>
            ))}
          </ol>
        )}
        {more && (
          <button type="button" className={buttonClass} onClick={() => setPage(page + 1)}>
            Older versions
          </button>
        )}
      </div>
    </Dialog>
  )
}
