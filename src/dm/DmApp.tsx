import {
  ChevronDown,
  EyeOff,
  Keyboard,
  MonitorUp,
  Moon,
  Redo2,
  Settings,
  Sun,
  Swords,
  Undo2,
} from 'lucide-react'
import { useEffect } from 'react'
import { useTheme } from '../app/theme'
import { AssetDialog } from '../panels/AssetDialog'
import { LayersPanel } from '../panels/LayersPanel'
import { LibraryPanel } from '../panels/LibraryPanel'
import { PlayerViewPanel } from '../panels/PlayerViewPanel'
import { PropertiesPanel } from '../panels/PropertiesPanel'
import { openPlayerWindow } from '../player/openPlayerWindow'
import { pruneSelection, redoAction, undoAction } from '../store/actions'
import { useCampaign, useCampaignStore } from '../store/campaign'
import { useSessionStore } from '../store/session'
import { useUiStore } from '../store/ui'
import { IconButton } from '../ui/controls'
import { CampaignsDialog } from './CampaignsDialog'
import { DmCanvas } from './canvas/DmCanvas'
import { ConfirmDialog } from './ConfirmDialog'
import { ContextMenu } from './ContextMenu'
import { SaveIndicator } from './SaveIndicator'
import { SceneBar } from './SceneBar'
import { setBlackout } from './presentation'
import { startSession } from './session'
import { InactiveScreen, LoadFailedScreen, StartingScreen } from './SessionScreens'
import { SettingsDialog } from './SettingsDialog'
import { MOD, useShortcuts } from './shortcuts'
import { ShortcutsDialog } from './ShortcutsDialog'
import { Toolbar } from './Toolbar'

function HistoryButtons() {
  const undoLabel = useCampaignStore((s) => s.past.at(-1)?.label ?? null)
  const redoLabel = useCampaignStore((s) => s.future.at(-1)?.label ?? null)
  return (
    <div className="flex items-center gap-0.5">
      <IconButton
        icon={Undo2}
        label={undoLabel ? `Undo ${undoLabel}` : 'Undo'}
        title={undoLabel ? `Undo: ${undoLabel} (${MOD}+Z)` : `Nothing to undo (${MOD}+Z)`}
        disabled={undoLabel === null}
        onClick={undoAction}
      />
      <IconButton
        icon={Redo2}
        label={redoLabel ? `Redo ${redoLabel}` : 'Redo'}
        title={
          redoLabel ? `Redo: ${redoLabel} (${MOD}+Shift+Z)` : `Nothing to redo (${MOD}+Shift+Z)`
        }
        disabled={redoLabel === null}
        onClick={redoAction}
      />
    </div>
  )
}

function CampaignButton() {
  const name = useCampaign((c) => c.name)
  return (
    <button
      type="button"
      onClick={() => useUiStore.setState({ dialog: 'campaigns' })}
      title="Campaigns: rename, new, open, duplicate, delete"
      aria-label={`Campaign: ${name}. Manage campaigns`}
      className="flex max-w-64 min-w-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-medium hover:bg-surface-3"
    >
      <span className="truncate">{name}</span>
      <ChevronDown aria-hidden className="size-4 shrink-0 text-fg-muted" />
    </button>
  )
}

/** A loud reminder in the header while players see a black screen. */
function BlackoutBadge() {
  const blackout = useCampaign((c) => c.presentation.blackout)
  if (!blackout) return null
  return (
    <button
      type="button"
      onClick={() => setBlackout(false)}
      title="Players see a black screen. Click to lift the blackout."
      className="flex items-center gap-1.5 rounded-full border border-danger px-2.5 py-0.5 text-xs font-medium text-danger hover:bg-danger/10"
    >
      <EyeOff aria-hidden className="size-3.5" />
      Blackout on
    </button>
  )
}

function Dialogs() {
  const dialog = useUiStore((s) => s.dialog)
  return (
    <>
      {dialog === 'campaigns' && <CampaignsDialog />}
      {dialog === 'settings' && <SettingsDialog />}
      <AssetDialog />
    </>
  )
}

function Workspace() {
  const [theme, setTheme] = useTheme()
  const nextTheme = theme === 'dark' ? 'light' : 'dark'
  useShortcuts()

  return (
    // Mouse clicks must not leave focus on a button: Space (pan) would press it again.
    // Keyboard activation (detail === 0) keeps focus where it is.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- focus management only
    <div
      className="grid h-full grid-rows-[auto_minmax(0,1fr)]"
      onClick={(event) => {
        const button = event.target instanceof Element ? event.target.closest('button') : null
        if (event.detail > 0 && button && !button.closest('[role="menu"], dialog')) button.blur()
      }}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface px-3 py-2">
        <Swords aria-hidden className="size-5 text-accent" />
        <h1 className="text-sm font-semibold tracking-wide">Combat Map</h1>
        <CampaignButton />
        <HistoryButtons />
        <SaveIndicator />
        <BlackoutBadge />
        <div className="ml-auto flex items-center gap-2">
          <IconButton
            icon={Keyboard}
            label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            onClick={() => useUiStore.setState({ shortcutsOpen: true })}
          />
          <IconButton
            icon={Settings}
            label="Settings"
            onClick={() => useUiStore.setState({ dialog: 'settings' })}
          />
          <IconButton
            icon={theme === 'dark' ? Sun : Moon}
            label={`Switch to ${nextTheme} theme`}
            onClick={() => setTheme(nextTheme)}
          />
          <button
            type="button"
            onClick={() => openPlayerWindow()}
            className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:brightness-110"
          >
            <MonitorUp aria-hidden className="size-4" />
            Open player window
          </button>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[auto_minmax(0,1fr)_19rem]">
        <Toolbar />
        <main
          aria-label="Map canvas"
          className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]"
        >
          <SceneBar />
          <DmCanvas />
        </main>
        <aside
          aria-label="Library and properties"
          className="flex min-h-0 flex-col gap-5 overflow-y-auto border-l border-border bg-surface p-3"
        >
          <PlayerViewPanel />
          <LibraryPanel />
          <LayersPanel />
          <PropertiesPanel />
        </aside>
      </div>
      <ContextMenu />
      <ShortcutsDialog />
      <Dialogs />
    </div>
  )
}

/**
 * DM window (`#/dm`). Starts the DM session (lock, last campaign, autosave) and
 * renders the editor once this tab holds the lock and a campaign is loaded.
 */
export function DmApp() {
  const phase = useSessionStore((s) => s.phase)
  const loaded = useCampaignStore((s) => s.campaign !== null)

  useEffect(() => {
    startSession()
    // Keep the selection valid whatever changed the campaign (undo, layer locks, deletes).
    return useCampaignStore.subscribe((state, previous) => {
      if (state.campaign !== previous.campaign) pruneSelection()
    })
  }, [])

  let content = null
  if (phase === 'inactive') content = <InactiveScreen />
  else if (phase === 'failed') content = <LoadFailedScreen />
  else if (phase === 'ready' && loaded) content = <Workspace />
  else content = <StartingScreen />
  return (
    <>
      {content}
      <ConfirmDialog />
    </>
  )
}
