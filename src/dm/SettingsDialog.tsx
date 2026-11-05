import { HardDrive, ShieldCheck, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DIAGONAL_RULES, UNIT_SYSTEMS, type DiagonalRule, type UnitSystem } from '../state/types'
import { setUnrecorded, useCampaign } from '../store/campaign'
import { useSessionStore } from '../store/session'
import { setNpcVision } from '../store/fogActions'
import { useUiStore } from '../store/ui'
import { buttonClass, Field, inputClass, Toggle } from '../ui/controls'
import { Dialog } from '../ui/Dialog'

const DIAGONAL_LABELS: Record<DiagonalRule, string> = {
  five: '5e standard: a diagonal step counts as 1 square',
  alternating: 'Alternating 1 and 2 squares (DMG variant)',
  euclidean: 'Euclidean (true distance)',
}

const UNIT_LABELS: Record<UnitSystem, string> = {
  metric: 'Metric: meters (1 square = 1.5 m)',
  imperial: 'Imperial: feet (1 square = 5 ft)',
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}

function StorageSection() {
  const persisted = useSessionStore((s) => s.persisted)
  const unavailable = useSessionStore((s) => s.storageUnavailable)
  const localOnly = useCampaign((c) => c.library.filter((asset) => asset.localOnly).length)
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null)
  const [asking, setAsking] = useState(false)
  const [declined, setDeclined] = useState(false)

  useEffect(() => {
    let alive = true
    navigator.storage
      ?.estimate()
      .then((value) => {
        if (alive) setEstimate(value)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const askPersistence = async () => {
    setAsking(true)
    try {
      const granted = await navigator.storage.persist()
      useSessionStore.setState({ persisted: granted })
      setDeclined(!granted)
    } catch {
      setDeclined(true)
    } finally {
      setAsking(false)
    }
  }

  if (unavailable) {
    return (
      <p className="text-sm text-danger">
        This browser does not allow this site to store data (private mode or blocked storage), so
        nothing is saved.
      </p>
    )
  }
  return (
    <div className="space-y-3 text-sm">
      <p className="flex items-start gap-2">
        <HardDrive aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
        <span>
          Campaigns and uploaded images are saved in this browser.
          {estimate?.usage !== undefined &&
            ` Using ${formatBytes(estimate.usage)}${estimate.quota ? ` of about ${formatBytes(estimate.quota)} available` : ''}.`}
        </span>
      </p>
      {persisted ? (
        <p className="flex items-start gap-2">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-ok" />
          <span>Persistent storage is on: the browser will not clear this data on its own.</span>
        </p>
      ) : (
        <div className="flex items-start gap-2">
          <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
          <div className="space-y-2">
            <p>
              Persistent storage is off: the browser may delete this data when disk space runs low
              (Safari also clears sites not visited for a week).
            </p>
            <button
              type="button"
              className={buttonClass}
              disabled={asking}
              onClick={() => void askPersistence()}
            >
              Ask the browser to keep this data
            </button>
            {declined && (
              <p role="status" className="text-fg-muted">
                The browser declined. Chrome and Edge grant it to sites you use often, bookmark or
                install as an app; Firefox asks you. Until then, keep backups (backup export arrives
                in a later milestone).
              </p>
            )}
          </div>
        </div>
      )}
      {localOnly > 0 && (
        <p className="text-fg-muted">
          {localOnly === 1 ? '1 image is' : `${localOnly} images are`} too large to sync to a gist
          and will exist only in this browser.
        </p>
      )}
    </div>
  )
}

/** Campaign settings and device storage. Gist sync joins in milestone 8. */
export function SettingsDialog() {
  const diagonalRule = useCampaign((c) => c.settings.diagonalRule)
  const units = useCampaign((c) => c.settings.units)
  const npcVision = useCampaign((c) => c.settings.npcVision)
  return (
    <Dialog title="Settings" onClose={() => useUiStore.setState({ dialog: null })}>
      <div className="space-y-6">
        <section aria-labelledby="settings-rules" className="space-y-3">
          <h3 id="settings-rules" className="text-sm font-medium">
            Rules
          </h3>
          <Field label="Units of measurement">
            <select
              value={units}
              onChange={(event) => {
                const value = event.target.value as UnitSystem
                setUnrecorded((draft) => {
                  draft.settings.units = value
                })
              }}
              className={inputClass}
            >
              {UNIT_SYSTEMS.map((system) => (
                <option key={system} value={system}>
                  {UNIT_LABELS[system]}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-xs text-fg-muted">
            Distances, vision and templates are shown in these units. Rules are kept in feet and
            converted at 5 ft = 1.5 m, as in the metric editions of the rulebooks.
          </p>
          <Toggle
            checked={npcVision}
            onChange={setNpcVision}
            label="NPC allies with a vision radius reveal fog too"
          />
          <Field label="Diagonal movement">
            <select
              value={diagonalRule}
              onChange={(event) => {
                const rule = event.target.value as DiagonalRule
                setUnrecorded((draft) => {
                  draft.settings.diagonalRule = rule
                })
              }}
              className={inputClass}
            >
              {DIAGONAL_RULES.map((rule) => (
                <option key={rule} value={rule}>
                  {DIAGONAL_LABELS[rule]}
                </option>
              ))}
            </select>
          </Field>
        </section>
        <section aria-labelledby="settings-storage" className="space-y-3">
          <h3 id="settings-storage" className="text-sm font-medium">
            Storage
          </h3>
          <StorageSection />
        </section>
      </div>
    </Dialog>
  )
}
