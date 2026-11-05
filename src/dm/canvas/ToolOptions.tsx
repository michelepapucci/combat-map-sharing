import { Check, Pin, X } from 'lucide-react'
import { fromDisplayLength, toDisplayLength, unitSymbol } from '../../geometry/units'
import type { AoeShape } from '../../state/types'
import { currentScene } from '../../store/actions'
import { useActiveScene, useCampaign } from '../../store/campaign'
import {
  cleanTemplateFeet,
  MAX_TEMPLATE_FT,
  pinTemplate,
  reshaped,
  setShareRuler,
  TEMPLATE_COLORS,
} from '../../store/templateActions'
import { setTool, useUiStore } from '../../store/ui'
import { affectedBy, affectedText } from './affected'
import {
  buttonClass,
  CommitNumberInput,
  primaryButtonClass,
  Segmented,
  Toggle,
} from '../../ui/controls'

/** The floating option bars of the Measure and Area of effect tools (top of the canvas). */

const bar =
  'pointer-events-auto absolute top-3 left-1/2 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 space-y-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-lg'

const doneButton =
  'ml-auto flex items-center gap-1 rounded-md px-2 py-0.5 text-fg-muted hover:bg-surface-3 hover:text-fg'

/** Measure tool (SPEC §5.4): share with players, clear, how it works. */
export function MeasureToolbar() {
  const share = useCampaign((c) => c.settings.shareRuler)
  const measuring = useUiStore((s) => s.measurement !== null)
  return (
    <div role="region" aria-label="Measure tool" className={bar}>
      <div className="flex flex-wrap items-center gap-3">
        <Toggle checked={share} onChange={setShareRuler} label="Players see the ruler" />
        {measuring && (
          <button
            type="button"
            className={buttonClass}
            onClick={() => useUiStore.setState({ measurement: null, measuring: null })}
          >
            Clear
          </button>
        )}
        <button type="button" onClick={() => setTool('select')} className={doneButton}>
          <X aria-hidden className="size-4" />
          Done (Esc)
        </button>
      </div>
      <p className="text-xs text-fg-muted">
        Drag from a square to measure (centers snap; hold Alt for free points). Hold Shift as you
        release to add a waypoint and keep going. Esc clears.
      </p>
    </div>
  )
}

const SHAPES: readonly { value: AoeShape; label: string }[] = [
  { value: 'circle', label: 'Sphere' },
  { value: 'cylinder', label: 'Cylinder' },
  { value: 'cone', label: 'Cone' },
  { value: 'line', label: 'Line' },
  { value: 'cube', label: 'Cube' },
]

const HINTS: Record<AoeShape, string> = {
  circle: 'Drag from the center (an intersection or a square’s center) to set the radius.',
  cylinder: 'Drag from the center (an intersection or a square’s center) to set the radius.',
  cone: 'Drag from the point of origin (an intersection); Shift keeps 15° steps.',
  line: 'Drag from the point of origin along the line; Shift keeps 15° steps.',
  cube: 'Drag from a corner (an intersection) towards the opposite corner.',
}

/** Changes an option of the tool and the template being placed. */
function set(patch: {
  aoeShape?: AoeShape
  aoeColor?: string
  aoeLineWidthFt?: number
  aoeVisibleToPlayers?: boolean
}): void {
  const current = useUiStore.getState().tempTemplate
  const shaped =
    current && patch.aoeShape && patch.aoeShape !== current.shape
      ? reshaped(current, patch.aoeShape, currentScene().grid)
      : current
  useUiStore.setState({
    ...patch,
    tempTemplate: shaped
      ? {
          ...shaped,
          color: patch.aoeColor ?? shaped.color,
          widthFt: patch.aoeLineWidthFt ?? shaped.widthFt,
          visibleToPlayers: patch.aoeVisibleToPlayers ?? shaped.visibleToPlayers,
        }
      : null,
  })
}

/** Area-of-effect tool (SPEC §5.5): shape, color, width, visibility, and pinning. */
export function AoeToolbar() {
  const shape = useUiStore((s) => s.aoeShape)
  const color = useUiStore((s) => s.aoeColor)
  const widthFt = useUiStore((s) => s.aoeLineWidthFt)
  const visible = useUiStore((s) => s.aoeVisibleToPlayers)
  const temp = useUiStore((s) => s.tempTemplate)
  const units = useCampaign((c) => c.settings.units)
  const rule = useCampaign((c) => c.settings.aoeCoverage)
  const scene = useActiveScene()
  const affected = temp ? affectedBy(temp, scene.grid, rule, scene.layers.tokens) : null
  return (
    <div role="region" aria-label="Area of effect tool" className={bar}>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Template shape"
          value={shape}
          options={SHAPES}
          onChange={(aoeShape) => set({ aoeShape })}
        />
        {shape === 'line' && (
          <div className="flex items-center gap-1.5">
            <span className="text-fg-muted">Width</span>
            <div className="w-16">
              <CommitNumberInput
                aria-label={`Line width (${unitSymbol(units)})`}
                value={toDisplayLength(widthFt, units)}
                min={units === 'metric' ? 1.5 : 5}
                max={toDisplayLength(MAX_TEMPLATE_FT, units)}
                step={units === 'metric' ? 1.5 : 5}
                onCommit={(value) =>
                  set({ aoeLineWidthFt: cleanTemplateFeet(fromDisplayLength(value, units)) })
                }
              />
            </div>
            <span className="text-fg-muted">{unitSymbol(units)}</span>
          </div>
        )}
        <div
          role="radiogroup"
          aria-label="Color of new templates"
          className="flex items-center gap-1"
        >
          {TEMPLATE_COLORS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={color === option.value}
              aria-label={option.name}
              title={option.name}
              onClick={() => set({ aoeColor: option.value })}
              className="flex size-5 items-center justify-center rounded-full border border-border"
              style={{ background: option.value }}
            >
              {color === option.value && <Check aria-hidden className="size-3 text-black" />}
            </button>
          ))}
        </div>
        <Toggle
          checked={visible}
          onChange={(aoeVisibleToPlayers) => set({ aoeVisibleToPlayers })}
          label="Players see it"
        />
        <button type="button" onClick={() => setTool('select')} className={doneButton}>
          <X aria-hidden className="size-4" />
          Done (Esc)
        </button>
      </div>
      {temp ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span role="status">{affected ? affectedText(affected) : ''}</span>
          <button
            type="button"
            className={`${primaryButtonClass} ml-auto py-0.5`}
            onClick={() => pinTemplate()}
          >
            <Pin aria-hidden className="size-3.5" />
            Pin (Enter)
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => useUiStore.setState({ tempTemplate: null })}
          >
            Discard
          </button>
        </div>
      ) : (
        <p className="text-xs text-fg-muted">
          {HINTS[shape]} Sizes go in 5 ft steps; hold Alt for a free origin. A click places one the
          size of the last.
        </p>
      )}
    </div>
  )
}
