import { Check, Trash } from 'lucide-react'
import { affectedBy, affectedText } from '../dm/canvas/affected'
import { fromDisplayLength, toDisplayLength, unitSymbol } from '../geometry/units'
import { AOE_SHAPES, type AoeShape, type AoeTemplate } from '../state/types'
import { useActiveScene, useCampaign } from '../store/campaign'
import {
  deleteTemplates,
  MAX_TEMPLATE_FT,
  setTemplateShape,
  TEMPLATE_COLORS,
  updateTemplate,
} from '../store/templateActions'
import { CommitNumberInput, dangerButtonClass, Field, inputClass, Toggle } from '../ui/controls'

const SHAPE_LABELS: Record<AoeShape, string> = {
  circle: 'Sphere',
  cylinder: 'Cylinder',
  cone: 'Cone',
  line: 'Line',
  cube: 'Cube',
}

const SIZE_LABELS: Record<AoeShape, string> = {
  circle: 'Radius',
  cylinder: 'Radius',
  cone: 'Length',
  line: 'Length',
  cube: 'Side',
}

/** A pinned area-of-effect template (SPEC §5.5): every field, what it affects, delete. */
export function TemplateDetails({ template }: { template: AoeTemplate }) {
  const units = useCampaign((c) => c.settings.units)
  const rule = useCampaign((c) => c.settings.aoeCoverage)
  const scene = useActiveScene()
  const symbol = unitSymbol(units)
  const step = units === 'metric' ? 1.5 : 5
  const affected = affectedBy(template, scene.grid, rule, scene.layers.tokens)
  const feet = (value: number) => fromDisplayLength(value, units)
  return (
    <div className="space-y-3">
      <p className="text-xs text-fg-muted">Area of effect template</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Shape">
          <select
            value={template.shape}
            onChange={(event) => setTemplateShape(template.id, event.target.value as AoeShape)}
            className={inputClass}
          >
            {AOE_SHAPES.map((shape) => (
              <option key={shape} value={shape}>
                {SHAPE_LABELS[shape]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`${SIZE_LABELS[template.shape]} (${symbol})`}>
          <CommitNumberInput
            value={toDisplayLength(template.sizeFt, units)}
            min={step}
            max={toDisplayLength(MAX_TEMPLATE_FT, units)}
            step={step}
            onCommit={(value) => updateTemplate(template.id, { sizeFt: feet(value) })}
          />
        </Field>
        {template.shape === 'line' && (
          <Field label={`Width (${symbol})`}>
            <CommitNumberInput
              value={toDisplayLength(template.widthFt, units)}
              min={step}
              step={step}
              onCommit={(value) => updateTemplate(template.id, { widthFt: feet(value) })}
            />
          </Field>
        )}
        {template.shape !== 'circle' && template.shape !== 'cylinder' && (
          <Field label="Direction (°, clockwise from east)">
            <CommitNumberInput
              value={Math.round(template.directionDeg * 10) / 10}
              step={15}
              onCommit={(directionDeg) => updateTemplate(template.id, { directionDeg })}
            />
          </Field>
        )}
      </div>
      <div role="radiogroup" aria-label="Template color" className="flex items-center gap-1.5">
        {TEMPLATE_COLORS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={template.color === option.value}
            aria-label={option.name}
            title={option.name}
            onClick={() => updateTemplate(template.id, { color: option.value })}
            className="flex size-6 items-center justify-center rounded-full border border-border"
            style={{ background: option.value }}
          >
            {template.color === option.value && (
              <Check aria-hidden className="size-3.5 text-black" />
            )}
          </button>
        ))}
        <input
          type="color"
          aria-label="Custom color"
          value={template.color}
          onChange={(event) =>
            updateTemplate(
              template.id,
              { color: event.target.value },
              { coalesceKey: `template-color:${template.id}` },
            )
          }
          className="h-6 w-8 cursor-pointer rounded border border-border bg-surface-2"
        />
      </div>
      <Toggle
        checked={template.visibleToPlayers}
        onChange={(visibleToPlayers) => updateTemplate(template.id, { visibleToPlayers })}
        label="Players see it (H)"
      />
      <p role="status" className="text-xs text-fg-muted">
        {affectedText(affected)} (
        {rule === 'center' ? 'square centers inside' : 'squares at least half covered'})
      </p>
      <button
        type="button"
        className={dangerButtonClass}
        onClick={() => deleteTemplates([template.id])}
      >
        <Trash aria-hidden className="size-4" />
        Delete template
      </button>
    </div>
  )
}
