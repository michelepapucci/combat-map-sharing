import {
  CircleDashed,
  CloudFog,
  MonitorUp,
  Moon,
  MousePointer2,
  Radar,
  Ruler,
  Sun,
  Swords,
} from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import { useTheme } from '../app/theme'
import { openPlayerWindow } from '../player/openPlayerWindow'

interface ToolStub {
  label: string
  shortcut: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
}

// Placeholders for the left toolbar; the tools themselves arrive in milestones 2-7.
const TOOLS: readonly ToolStub[] = [
  { label: 'Select', shortcut: 'V', Icon: MousePointer2 },
  { label: 'Measure', shortcut: 'M', Icon: Ruler },
  { label: 'Area of effect', shortcut: 'A', Icon: CircleDashed },
  { label: 'Fog', shortcut: 'F', Icon: CloudFog },
  { label: 'Ping', shortcut: 'P', Icon: Radar },
]

/**
 * DM window (`#/dm`). Milestone 1 renders the application shell only: top bar,
 * left toolbar, canvas area and right-hand panels, wired to the theme toggle and
 * the "Open player window" button.
 */
export function DmApp() {
  const [theme, setTheme] = useTheme()
  const nextTheme = theme === 'dark' ? 'light' : 'dark'

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)]">
      <header className="flex items-center gap-3 border-b border-border bg-surface px-3 py-2">
        <Swords aria-hidden className="size-5 text-accent" />
        <h1 className="text-sm font-semibold tracking-wide">Combat Map</h1>
        <span className="text-xs text-fg-muted">DM view</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTheme(nextTheme)}
            className="rounded-md p-2 text-fg-muted hover:bg-surface-3 hover:text-fg"
            aria-label={`Switch to ${nextTheme} theme`}
            title={`Switch to ${nextTheme} theme`}
          >
            {theme === 'dark' ? (
              <Sun aria-hidden className="size-4" />
            ) : (
              <Moon aria-hidden className="size-4" />
            )}
          </button>
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

      <div className="grid min-h-0 grid-cols-[auto_minmax(0,1fr)_18rem]">
        <nav
          aria-label="Tools"
          className="flex flex-col gap-1 border-r border-border bg-surface p-1.5"
        >
          {TOOLS.map(({ label, shortcut, Icon }) => (
            <button
              key={label}
              type="button"
              disabled
              className="rounded-md p-2 text-fg-muted disabled:opacity-50"
              aria-label={`${label} (${shortcut})`}
              title={`${label} (${shortcut}) · coming soon`}
            >
              <Icon aria-hidden className="size-5" />
            </button>
          ))}
        </nav>

        <main
          aria-label="Map canvas"
          className="flex items-center justify-center bg-bg p-6 text-center"
        >
          <div className="max-w-md space-y-2">
            <p className="text-lg font-medium">Drop a map image here or pick a default map</p>
            <p className="text-sm text-fg-muted">
              The canvas, grid and tools arrive in milestone 2. For now you can switch the theme and
              open the player window.
            </p>
          </div>
        </main>

        <aside
          aria-label="Library and properties"
          className="flex flex-col gap-3 border-l border-border bg-surface p-3"
        >
          <section aria-labelledby="library-heading" className="space-y-1">
            <h2
              id="library-heading"
              className="text-xs font-semibold tracking-wider text-fg-muted uppercase"
            >
              Library
            </h2>
            <p className="text-sm text-fg-muted">Tokens, props and maps.</p>
          </section>
          <section aria-labelledby="properties-heading" className="space-y-1">
            <h2
              id="properties-heading"
              className="text-xs font-semibold tracking-wider text-fg-muted uppercase"
            >
              Properties
            </h2>
            <p className="text-sm text-fg-muted">Select something on the map to edit it.</p>
          </section>
        </aside>
      </div>
    </div>
  )
}
