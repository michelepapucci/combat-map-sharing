import { Keyboard, MonitorUp, Moon, Redo2, Sun, Swords, Undo2 } from 'lucide-react'
import { useEffect } from 'react'
import { useTheme } from '../app/theme'
import { LayersPanel } from '../panels/LayersPanel'
import { LibraryPanel } from '../panels/LibraryPanel'
import { PropertiesPanel } from '../panels/PropertiesPanel'
import { openPlayerWindow } from '../player/openPlayerWindow'
import { createCampaign } from '../state/defaults'
import { pruneSelection, redoAction, undoAction } from '../store/actions'
import { loadCampaign, useCampaignStore } from '../store/campaign'
import { useUiStore } from '../store/ui'
import { IconButton } from '../ui/controls'
import { DmCanvas } from './canvas/DmCanvas'
import { ContextMenu } from './ContextMenu'
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
      <header className="flex items-center gap-3 border-b border-border bg-surface px-3 py-2">
        <Swords aria-hidden className="size-5 text-accent" />
        <h1 className="text-sm font-semibold tracking-wide">Combat Map</h1>
        <span className="text-xs text-fg-muted">DM view</span>
        <HistoryButtons />
        <div className="ml-auto flex items-center gap-2">
          <IconButton
            icon={Keyboard}
            label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            onClick={() => useUiStore.setState({ shortcutsOpen: true })}
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
        <main aria-label="Map canvas" className="min-h-0 min-w-0">
          <DmCanvas />
        </main>
        <aside
          aria-label="Library and properties"
          className="flex min-h-0 flex-col gap-5 overflow-y-auto border-l border-border bg-surface p-3"
        >
          <LibraryPanel />
          <LayersPanel />
          <PropertiesPanel />
        </aside>
      </div>
      <ContextMenu />
      <ShortcutsDialog />
    </div>
  )
}

/**
 * DM window (`#/dm`). Loads a campaign on mount (a fresh one until milestone 3
 * adds persistence) and renders the editor once it is there.
 */
export function DmApp() {
  const loaded = useCampaignStore((s) => s.campaign !== null)

  useEffect(() => {
    if (!useCampaignStore.getState().campaign) loadCampaign(createCampaign())
    // Keep the selection valid whatever changed the campaign (undo, layer locks, deletes).
    return useCampaignStore.subscribe((state, previous) => {
      if (state.campaign !== previous.campaign) pruneSelection()
    })
  }, [])

  return loaded ? <Workspace /> : null
}
