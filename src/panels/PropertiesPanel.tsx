import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Grid3x3, Lock, LockOpen, Trash } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { TOKEN_COLORS } from '../assets/builtin/registry'
import { fromDisplayLength, toDisplayLength } from '../geometry/units'
import { findItem } from '../state/sceneOps'
import { MAX_NAME_LENGTH } from '../state/validate'
import {
  FOOTPRINT_CELLS,
  SIZE_CATEGORIES,
  TOKEN_KINDS,
  type Item,
  type LayerName,
  type Token,
  type TokenKind,
} from '../state/types'
import {
  deleteItems,
  duplicateItems,
  reorderItems,
  setHidden,
  toggleLocked,
  updateGrid,
  updateItem,
} from '../store/actions'
import { MOD } from '../dm/shortcuts'
import { useActiveScene, useCampaign } from '../store/campaign'
import { setTool, useUiStore } from '../store/ui'
import {
  buttonClass,
  CommitNumberInput,
  CommitTextInput,
  Field,
  inputClass,
  SectionHeading,
  Toggle,
} from '../ui/controls'

const LAYER_LABEL: Record<LayerName, string> = { map: 'Map', props: 'Prop', tokens: 'Token' }
const KIND_LABEL: Record<TokenKind, string> = { player: 'Player', npc: 'NPC', enemy: 'Enemy' }

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function ItemActions({ ids, items }: { ids: string[]; items: Item[] }) {
  const anyVisible = items.some((item) => !item.hidden)
  const anyUnlocked = items.some((item) => !item.locked)
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        className={buttonClass}
        onClick={() => setHidden(ids, anyVisible)}
        title="Hide or show (H)"
      >
        {anyVisible ? (
          <EyeOff aria-hidden className="size-4" />
        ) : (
          <Eye aria-hidden className="size-4" />
        )}
        {anyVisible ? 'Hide' : 'Show'}
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={() => toggleLocked(ids)}
        title="Lock or unlock (L)"
      >
        {anyUnlocked ? (
          <Lock aria-hidden className="size-4" />
        ) : (
          <LockOpen aria-hidden className="size-4" />
        )}
        {anyUnlocked ? 'Lock' : 'Unlock'}
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={() => reorderItems(ids, 'forward')}
        title="Bring forward"
      >
        <ArrowUp aria-hidden className="size-4" />
        Forward
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={() => reorderItems(ids, 'backward')}
        title="Send backward"
      >
        <ArrowDown aria-hidden className="size-4" />
        Backward
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={() => duplicateItems(ids)}
        title={`Duplicate (${MOD}+D)`}
      >
        <Copy aria-hidden className="size-4" />
        Duplicate
      </button>
      <button
        type="button"
        className={`${buttonClass} text-danger`}
        onClick={() => deleteItems(ids)}
        disabled={!anyUnlocked}
        title={anyUnlocked ? 'Delete (Del)' : 'Unlock to delete'}
      >
        <Trash aria-hidden className="size-4" />
        Delete
      </button>
    </div>
  )
}

function TokenFields({ token }: { token: Token }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Kind">
          <select
            value={token.kind}
            onChange={(event) => updateItem(token.id, { kind: event.target.value as TokenKind })}
            className={inputClass}
          >
            {TOKEN_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Size">
          <select
            value={token.sizeCategory}
            onChange={(event) =>
              updateItem(token.id, { sizeCategory: event.target.value as Token['sizeCategory'] })
            }
            className={inputClass}
          >
            {SIZE_CATEGORIES.map((size) => (
              <option key={size} value={size}>
                {capitalize(size)} ({FOOTPRINT_CELLS[size]}×{FOOTPRINT_CELLS[size]})
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <Field label="Badge (1–3 characters, shown to players)">
          <CommitTextInput
            key={token.id}
            value={token.badge ?? ''}
            maxLength={3}
            onCommit={(badge) =>
              updateItem(token.id, { badge: badge.trim() === '' ? null : badge.trim() })
            }
          />
        </Field>
        <Field label="Color">
          <input
            type="color"
            value={token.color}
            onChange={(event) =>
              updateItem(
                token.id,
                { color: event.target.value },
                { coalesceKey: `color:${token.id}` },
              )
            }
            className="h-8 w-12 cursor-pointer rounded-md border border-border bg-surface-2"
          />
        </Field>
      </div>
      <div role="group" aria-label="Preset colors" className="flex flex-wrap gap-1">
        {TOKEN_COLORS.map((swatch) => (
          <button
            key={swatch.value}
            type="button"
            aria-label={swatch.name}
            aria-pressed={token.color.toLowerCase() === swatch.value}
            title={swatch.name}
            onClick={() => updateItem(token.id, { color: swatch.value })}
            className="flex size-6 items-center justify-center rounded-full border-2 border-transparent aria-pressed:border-fg"
          >
            <span className="size-4 rounded-full" style={{ background: swatch.value }} />
          </button>
        ))}
      </div>
    </>
  )
}

function SingleItem({ item, layer }: { item: Item; layer: LayerName }) {
  const nameRef = useRef<HTMLInputElement>(null)
  const focusRequest = useUiStore((s) => s.propertiesFocusRequest)
  // Requests made before this item was shown are not for it.
  const handledRequest = useRef(focusRequest)
  useEffect(() => {
    if (focusRequest === handledRequest.current) return
    handledRequest.current = focusRequest
    nameRef.current?.focus()
  }, [focusRequest])
  const token = layer === 'tokens' ? (item as Token) : null
  return (
    <div className="space-y-3">
      <p className="text-xs text-fg-muted">
        {LAYER_LABEL[layer]}
        {item.hidden && ' · hidden from players'}
        {item.locked && ' · locked'}
      </p>
      <Field label="Name (DM only)">
        <CommitTextInput
          key={item.id}
          ref={nameRef}
          value={item.name}
          maxLength={MAX_NAME_LENGTH}
          onCommit={(name) => updateItem(item.id, { name })}
        />
      </Field>
      {token && <TokenFields token={token} />}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Rotation (°)">
          <CommitNumberInput
            value={item.rotation}
            step={15}
            onCommit={(rotation) => updateItem(item.id, { rotation })}
          />
        </Field>
        <Field label={`Opacity ${Math.round(item.opacity * 100)}%`}>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={item.opacity}
            onChange={(event) =>
              updateItem(
                item.id,
                { opacity: Number(event.target.value) },
                { coalesceKey: `opacity:${item.id}` },
              )
            }
            className="h-8 accent-[var(--accent)]"
          />
        </Field>
      </div>
      <ItemActions ids={[item.id]} items={[item]} />
      {token && (
        <p className="text-xs text-fg-muted">
          Vision, hit points, conditions and notes arrive in milestone 5.
        </p>
      )}
    </div>
  )
}

function GridSettings() {
  const scene = useActiveScene()
  const units = useCampaign((c) => c.settings.units)
  const { grid } = scene
  return (
    <div className="space-y-3">
      <Toggle
        checked={grid.visible}
        onChange={(visible) => updateGrid({ visible })}
        label="Show grid"
      />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Cell size (px)">
          <CommitNumberInput
            value={grid.size}
            min={4}
            max={2000}
            step={1}
            onCommit={(size) => updateGrid({ size })}
          />
        </Field>
        <Field label={units === 'metric' ? 'Meters per square' : 'Feet per square'}>
          <CommitNumberInput
            value={toDisplayLength(grid.feetPerCell, units)}
            min={units === 'metric' ? 0.3 : 1}
            max={units === 'metric' ? 300 : 1000}
            step={units === 'metric' ? 0.5 : 1}
            onCommit={(length) => updateGrid({ feetPerCell: fromDisplayLength(length, units) })}
          />
        </Field>
        <Field label="Offset X (px)">
          <CommitNumberInput
            value={grid.offsetX}
            step={1}
            onCommit={(offsetX) => updateGrid({ offsetX })}
          />
        </Field>
        <Field label="Offset Y (px)">
          <CommitNumberInput
            value={grid.offsetY}
            step={1}
            onCommit={(offsetY) => updateGrid({ offsetY })}
          />
        </Field>
        <Field label="Color">
          <input
            type="color"
            value={grid.color}
            onChange={(event) =>
              updateGrid({ color: event.target.value }, { coalesceKey: 'grid-color' })
            }
            className="h-8 w-full cursor-pointer rounded-md border border-border bg-surface-2"
          />
        </Field>
        <Field label={`Opacity ${Math.round(grid.opacity * 100)}%`}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={grid.opacity}
            onChange={(event) =>
              updateGrid({ opacity: Number(event.target.value) }, { coalesceKey: 'grid-opacity' })
            }
            className="h-8 accent-[var(--accent)]"
          />
        </Field>
      </div>
      <button
        type="button"
        className={`${buttonClass} w-full`}
        onClick={() => setTool('calibrate')}
      >
        <Grid3x3 aria-hidden className="size-4" />
        Calibrate to the map's grid…
      </button>
    </div>
  )
}

/** Properties of the selection, or the scene's grid settings when nothing is selected. */
export function PropertiesPanel() {
  const scene = useActiveScene()
  const selection = useUiStore((s) => s.selection)
  const refs = selection.flatMap((id) => findItem(scene, id) ?? [])
  const single = refs.length === 1 ? refs[0] : undefined
  const heading = refs.length === 0 ? 'Grid' : 'Properties'
  return (
    <section aria-labelledby="properties-heading" className="space-y-2">
      <SectionHeading id="properties-heading">{heading}</SectionHeading>
      {refs.length === 0 && <GridSettings />}
      {single && <SingleItem key={single.item.id} item={single.item} layer={single.layer} />}
      {refs.length > 1 && (
        <div className="space-y-3">
          <p className="text-sm">{refs.length} items selected</p>
          <ItemActions ids={refs.map((ref) => ref.item.id)} items={refs.map((ref) => ref.item)} />
        </div>
      )}
    </section>
  )
}
