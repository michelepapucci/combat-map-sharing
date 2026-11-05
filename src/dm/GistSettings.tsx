import { CloudUpload, Download, ExternalLink, History, Link2Off, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { GistSummary } from '../gist/api'
import { AUTO_SYNC_MINUTES } from '../persistence/gistLinks'
import { useCampaign } from '../store/campaign'
import { useGistStore } from '../store/gist'
import { useUiStore } from '../store/ui'
import {
  buttonClass,
  dangerButtonClass,
  Field,
  inputClass,
  primaryButtonClass,
  Toggle,
} from '../ui/controls'
import {
  connectGist,
  disconnectGist,
  listCampaignGists,
  loadFromGist,
  openGist,
  saveToGist,
  setAutoSync,
  unlinkGist,
} from './gist'
import { MOD } from './shortcuts'

/**
 * Settings → Sync with a GitHub Gist (SPEC §7): the token, then this
 * campaign's gist. Gist links open on github.com (navigation, not a fetch).
 */

const link = 'text-accent underline underline-offset-2 hover:brightness-110'

function SecretWarning() {
  return (
    <p className="rounded-md border border-border bg-surface-2 px-2.5 py-2 text-xs">
      <strong>Secret gists are unlisted, not private:</strong> anyone with the link can read them.
      Do not share the gist link, and keep anything truly sensitive out of DM notes.
    </p>
  )
}

function ConnectForm() {
  const [token, setToken] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    void connectGist(token, remember).then((ok) => {
      setBusy(false)
      if (ok) setToken('')
    })
  }
  return (
    <form onSubmit={submit} className="space-y-2.5">
      <p className="text-xs text-fg-muted">
        Save campaigns to a gist on your GitHub account to keep them safe and open them on another
        computer. Create a{' '}
        <a
          className={link}
          href="https://github.com/settings/personal-access-tokens/new"
          target="_blank"
          rel="noreferrer"
        >
          fine-grained token
        </a>{' '}
        with only the account permission “Gists: read and write” and an expiry date, or a{' '}
        <a
          className={link}
          href="https://github.com/settings/tokens/new?scopes=gist&description=Combat%20Map"
          target="_blank"
          rel="noreferrer"
        >
          classic token
        </a>{' '}
        with only the “gist” scope, then paste it here.
      </p>
      <Field label="GitHub token">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          className={inputClass}
        />
      </Field>
      <Toggle checked={remember} onChange={setRemember} label="Remember the token on this device" />
      <p className="text-xs text-fg-muted">
        A remembered token is stored in this browser for {location.origin}, where any other page
        published at that address could read it: use a token that can reach gists only. Not
        remembered, it lasts until you close this tab.
      </p>
      <button type="submit" className={primaryButtonClass} disabled={busy || token.trim() === ''}>
        {busy ? 'Checking…' : 'Connect'}
      </button>
    </form>
  )
}

function statusText(status: string, error: string | null): string {
  switch (status) {
    case 'synced':
      return 'Everything is saved to the gist.'
    case 'unsynced':
      return 'There are changes not yet saved to the gist.'
    case 'syncing':
      return 'Talking to GitHub…'
    case 'conflict':
      return 'The gist changed on another device: save or load to choose which version wins.'
    case 'error':
      return `Last attempt failed: ${error ?? 'unknown error'}`
    default:
      return ''
  }
}

function LinkedControls() {
  const gistLink = useGistStore((s) => s.link)
  const status = useGistStore((s) => s.status)
  const error = useGistStore((s) => s.error)
  const rateLimit = useGistStore((s) => s.rateLimit)
  if (!gistLink) return null
  const busy = status === 'syncing'
  return (
    <div className="space-y-2.5">
      <p className="text-sm">
        This campaign syncs with{' '}
        <a
          className={link}
          href={`https://gist.github.com/${gistLink.gistId}`}
          target="_blank"
          rel="noreferrer"
        >
          its secret gist
          <ExternalLink aria-hidden className="ml-0.5 inline size-3" />
        </a>
        .
      </p>
      <p
        role="status"
        className={`text-xs ${status === 'error' ? 'text-danger' : 'text-fg-muted'}`}
      >
        {statusText(status, error)}
        {status === 'error' && rateLimit && rateLimit.remaining === 0 && (
          <> GitHub’s limit resets at {new Date(rateLimit.resetAt).toLocaleTimeString()}.</>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={primaryButtonClass}
          disabled={busy}
          onClick={() => void saveToGist()}
          title={`Save to the gist (${MOD}+S)`}
        >
          <CloudUpload aria-hidden className="size-4" />
          Save to gist
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => void loadFromGist()}
        >
          <Download aria-hidden className="size-4" />
          Load from gist
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => useUiStore.setState({ dialog: 'gist-history' })}
        >
          <History aria-hidden className="size-4" />
          Restore an earlier version…
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Toggle
          checked={gistLink.autoSync}
          onChange={(autoSync) => void setAutoSync(autoSync, gistLink.intervalMin)}
          label="Save to the gist automatically every"
        />
        <div className="w-24">
          <select
            aria-label="Minutes between automatic saves"
            value={gistLink.intervalMin}
            onChange={(event) => void setAutoSync(gistLink.autoSync, Number(event.target.value))}
            className={inputClass}
          >
            {AUTO_SYNC_MINUTES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} min
              </option>
            ))}
          </select>
        </div>
        <span className="text-xs text-fg-muted">and on scene switches, when something changed</span>
      </div>
      <button type="button" className={dangerButtonClass} onClick={() => void unlinkGist()}>
        <Link2Off aria-hidden className="size-4" />
        Stop syncing this campaign
      </button>
    </div>
  )
}

function closeDialog(): void {
  useUiStore.setState({ dialog: null })
}

/** Opens a gist's campaign; the dialog closes when it opened. */
function openAndClose(input: string): void {
  void openGist(input).then((ok) => {
    if (ok) closeDialog()
  })
}

function UnlinkedControls() {
  const name = useCampaign((c) => c.name)
  const [address, setAddress] = useState('')
  const [gists, setGists] = useState<GistSummary[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const busy = useGistStore((s) => s.status === 'syncing')
  return (
    <div className="space-y-3">
      <button
        type="button"
        className={primaryButtonClass}
        disabled={busy}
        onClick={() => void saveToGist()}
      >
        <Plus aria-hidden className="size-4" />
        Create a secret gist for “{name}”
      </button>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          openAndClose(address)
        }}
      >
        <Field label="Or open a campaign from an existing gist" className="flex-1">
          <input
            value={address}
            placeholder="https://gist.github.com/you/…"
            onChange={(event) => setAddress(event.target.value)}
            className={inputClass}
          />
        </Field>
        <button type="submit" className={buttonClass} disabled={address.trim() === ''}>
          Open
        </button>
      </form>
      {listError && (
        <p role="alert" className="text-xs text-danger">
          Your gists could not be listed: {listError}
        </p>
      )}
      {gists === null ? (
        <button
          type="button"
          className={buttonClass}
          disabled={loading}
          onClick={() => {
            setLoading(true)
            setListError(null)
            void listCampaignGists()
              .then(setGists)
              .catch((error: unknown) =>
                setListError(error instanceof Error ? error.message : String(error)),
              )
              .finally(() => setLoading(false))
          }}
        >
          {loading ? 'Looking…' : 'Show my campaign gists'}
        </button>
      ) : gists.length === 0 ? (
        <p className="text-xs text-fg-muted">No campaign gists on this GitHub account yet.</p>
      ) : (
        <ul
          aria-label="Your campaign gists"
          className="divide-y divide-border rounded-lg border border-border"
        >
          {gists.map((gist) => (
            <li key={gist.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {gist.description || gist.id}
                <span className="ml-2 text-xs text-fg-muted">
                  {new Date(gist.updatedAt).toLocaleDateString()}
                </span>
              </span>
              <button type="button" className={buttonClass} onClick={() => openAndClose(gist.id)}>
                Open
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The Sync section of Settings. */
export function GistSettings() {
  const token = useGistStore((s) => s.token)
  const login = useGistStore((s) => s.login)
  const linked = useGistStore((s) => s.link !== null)
  return (
    <div className="space-y-3">
      {token ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Connected to GitHub{login ? ` as ${login}` : ''}.</span>
            <button
              type="button"
              className="text-xs text-fg-muted underline underline-offset-2 hover:text-fg"
              onClick={() => void disconnectGist()}
            >
              Disconnect (forget the token)
            </button>
          </div>
          {linked ? <LinkedControls /> : <UnlinkedControls />}
        </>
      ) : (
        <ConnectForm />
      )}
      <SecretWarning />
    </div>
  )
}
