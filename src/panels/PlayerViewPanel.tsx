import { Eye, EyeOff, MonitorPlay, ScanEye } from 'lucide-react'
import { pushView, setBlackout, setCameraMode, setSplash } from '../dm/presentation'
import type { PlayerCameraMode } from '../state/types'
import { useCampaign } from '../store/campaign'
import { setLockedCellPx, useDevicePrefs } from '../store/devicePrefs'
import { useSessionStore } from '../store/session'
import { useUiStore } from '../store/ui'
import { buttonClass, CommitNumberInput, Field, inputClass, SectionHeading } from '../ui/controls'

const MODES: readonly { mode: PlayerCameraMode; label: string; hint: string }[] = [
  {
    mode: 'pushed',
    label: 'Pushed view',
    hint: 'Players see the view you push with the button below',
  },
  { mode: 'follow', label: 'Follow my view', hint: 'Players see what you see, live' },
  {
    mode: 'fit-explored',
    label: 'Fit explored area',
    hint: 'Frames what players have seen (the map when fog is off)',
  },
]

const DEFAULT_LOCKED_CELL_PX = 70

/** Presentation controls (SPEC §5.9): camera mode, pushed view, blackout, scale lock. */
export function PlayerViewPanel() {
  const players = useSessionStore((s) => s.players)
  const mode = useCampaign((c) => c.presentation.cameraMode)
  const blackout = useCampaign((c) => c.presentation.blackout)
  const splash = useCampaign((c) => c.presentation.splashAssetId)
  const library = useCampaign((c) => c.library)
  const lockedCellPx = useDevicePrefs((s) => s.lockedCellPx)
  const preview = useUiStore((s) => s.previewAsPlayers)

  return (
    <section aria-labelledby="player-view-heading" className="space-y-3">
      <div className="flex items-center gap-2">
        <SectionHeading id="player-view-heading">Player view</SectionHeading>
        <span
          role="status"
          className={`ml-auto flex items-center gap-1.5 text-xs ${players > 0 ? 'text-ok' : 'text-fg-muted'}`}
        >
          <span
            aria-hidden
            className={`size-2 rounded-full ${players > 0 ? 'bg-ok' : 'border border-fg-muted'}`}
          />
          {players === 0
            ? 'No player window'
            : players === 1
              ? '1 window connected'
              : `${players} windows connected`}
        </span>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs text-fg-muted">Camera</legend>
        {MODES.map((option) => (
          <label
            key={option.mode}
            className="flex cursor-pointer items-center gap-2 text-sm"
            title={option.hint}
          >
            <input
              type="radio"
              name="player-camera-mode"
              checked={mode === option.mode}
              onChange={() => setCameraMode(option.mode)}
              className="size-4 accent-[var(--accent)]"
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        className={`${buttonClass} w-full`}
        onClick={pushView}
        title="Players see exactly the area of the map you see now"
      >
        <ScanEye aria-hidden className="size-4" />
        Push my view to players
      </button>

      <button
        type="button"
        aria-pressed={preview}
        className={`${buttonClass} w-full`}
        onClick={() => useUiStore.setState({ previewAsPlayers: !preview })}
        title="Show in this window exactly what the players' screen shows (Esc to stop)"
      >
        <MonitorPlay aria-hidden className="size-4" />
        {preview ? 'Stop preview' : 'Preview as players'}
      </button>

      <div className="space-y-2">
        <button
          type="button"
          aria-pressed={blackout}
          onClick={() => setBlackout(!blackout)}
          title="Players see a black screen (or the splash image) while you set up"
          className={`${buttonClass} w-full ${blackout ? 'border-danger text-danger' : ''}`}
        >
          {blackout ? (
            <EyeOff aria-hidden className="size-4" />
          ) : (
            <Eye aria-hidden className="size-4" />
          )}
          {blackout ? 'Blackout is on: lift it' : 'Blackout'}
        </button>
        <Field label="During blackout show">
          <select
            className={inputClass}
            value={splash ?? ''}
            onChange={(event) => setSplash(event.target.value === '' ? null : event.target.value)}
          >
            <option value="">A black screen</option>
            {library.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="space-y-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={lockedCellPx !== null}
            onChange={(event) =>
              setLockedCellPx(event.target.checked ? DEFAULT_LOCKED_CELL_PX : null)
            }
            className="size-4 accent-[var(--accent)]"
          />
          Fixed scale on the player screen
        </label>
        {lockedCellPx !== null && (
          <Field label="1 square = N screen pixels (this device)">
            <CommitNumberInput
              value={lockedCellPx}
              min={10}
              max={600}
              step={1}
              onCommit={(value) => setLockedCellPx(value)}
            />
          </Field>
        )}
      </div>
    </section>
  )
}
