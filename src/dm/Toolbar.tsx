import { CircleDashed, CloudFog, Grid3x3, Magnet, MousePointer2, Radar, Ruler } from 'lucide-react'
import type { Tool } from '../state/types'
import { setSnapEnabled } from '../store/actions'
import { useCampaign } from '../store/campaign'
import { setTool, useUiStore } from '../store/ui'
import type { Icon } from '../ui/controls'

interface ToolButton {
  tool: Tool
  label: string
  shortcut: string | null
  Icon: Icon
  /** Milestone that brings the tool, while it is not built yet. */
  comingIn: number | null
}

const TOOL_BUTTONS: readonly ToolButton[] = [
  { tool: 'select', label: 'Select', shortcut: 'V', Icon: MousePointer2, comingIn: null },
  { tool: 'measure', label: 'Measure', shortcut: 'M', Icon: Ruler, comingIn: 7 },
  { tool: 'aoe', label: 'Area of effect', shortcut: 'A', Icon: CircleDashed, comingIn: 7 },
  {
    tool: 'fog',
    label: 'Fog: reveal or hide by hand',
    shortcut: 'F',
    Icon: CloudFog,
    comingIn: null,
  },
  { tool: 'ping', label: 'Ping (or Alt+click)', shortcut: 'P', Icon: Radar, comingIn: null },
  {
    tool: 'calibrate',
    label: 'Calibrate grid to the map',
    shortcut: null,
    Icon: Grid3x3,
    comingIn: null,
  },
]

const buttonClass =
  'rounded-md p-2 text-fg-muted hover:bg-surface-3 hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent aria-pressed:bg-surface-3 aria-pressed:text-accent'

/** Left toolbar (SPEC §8): tools plus the global snap toggle. */
export function Toolbar() {
  const tool = useUiStore((s) => s.tool)
  const snapEnabled = useCampaign((c) => c.settings.snapEnabled)
  return (
    <div
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      className="flex flex-col gap-1 border-r border-border bg-surface p-1.5"
    >
      {TOOL_BUTTONS.map(({ tool: id, label, shortcut, Icon, comingIn }) => {
        const name = shortcut ? `${label} (${shortcut})` : label
        return (
          <button
            key={id}
            type="button"
            disabled={comingIn !== null}
            aria-pressed={tool === id}
            aria-label={name}
            title={comingIn !== null ? `${name}: arrives in milestone ${comingIn}` : name}
            onClick={() => setTool(tool === id && id !== 'select' ? 'select' : id)}
            className={buttonClass}
          >
            <Icon aria-hidden className="size-5" />
          </button>
        )
      })}
      <div className="my-1 border-t border-border" />
      <button
        type="button"
        aria-pressed={snapEnabled}
        aria-label="Snap to grid"
        title={`Snap to grid: ${snapEnabled ? 'on' : 'off'} (hold Alt to bypass while dragging)`}
        onClick={() => setSnapEnabled(!snapEnabled)}
        className={buttonClass}
      >
        <Magnet aria-hidden className="size-5" />
      </button>
    </div>
  )
}
