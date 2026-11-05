import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Dices,
  Eye,
  EyeOff,
  GripVertical,
  Plus,
  Swords,
  X,
} from 'lucide-react'
import { useId, useMemo, useState, type FormEvent } from 'react'
import { effectiveVisibility, sortInitiative } from '../geometry/initiative'
import { confirmAction } from '../dm/confirm'
import { MAX_NAME_LENGTH } from '../state/validate'
import type { InitiativeEntry, Scene } from '../state/types'
import { useActiveScene } from '../store/campaign'
import {
  activeToken,
  addNamedEntry,
  addTokensToInitiative,
  centerOnActiveToken,
  endCombat,
  MAX_INITIATIVE,
  moveAmongTies,
  nextTurn,
  previousTurn,
  removeEntry,
  rollInitiative,
  setTrackerVisible,
  tiedWith,
  toggleEntryVisibility,
  tokensNotInInitiative,
  updateEntry,
} from '../store/initiativeActions'
import { useUiStore } from '../store/ui'
import {
  buttonClass,
  CommitNumberInput,
  CommitTextInput,
  dangerButtonClass,
  IconButton,
  inputClass,
  Toggle,
} from '../ui/controls'

/**
 * The initiative tracker (SPEC §5.8): turn order of the active scene, turns and
 * rounds, what players see of it. Collapsible; open by default.
 */

const OPEN_KEY = 'vtt:initiativeOpen'

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== 'false'
  } catch {
    return true
  }
}

function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, String(open))
  } catch {
    // A preference only: ignore blocked storage.
  }
}

/** A short DM-side note under an entry: why players don't see it, its token's HP. */
function entryNote(entry: InitiativeEntry, scene: Scene): string | null {
  const token = entry.tokenId
    ? (scene.layers.tokens.find((t) => t.id === entry.tokenId) ?? null)
    : null
  const notes: string[] = []
  if (entry.tokenId && !token) notes.push('Token removed')
  const shown = effectiveVisibility(entry, scene) === 'shown'
  if (!shown && entry.visibility === 'auto' && token) {
    notes.push(token.hidden ? 'Hidden: its token is hidden' : 'Hidden: its layer is hidden')
  }
  if (shown && entry.visibility === 'shown' && token?.hidden) {
    notes.push('Shown, though its token is hidden')
  }
  if (token?.hp) notes.push(`HP ${token.hp.current}/${token.hp.max}`)
  return notes.length > 0 ? notes.join(' · ') : null
}

/** Reordering exact ties with the pointer: the entry moved and the row under the pointer. */
interface TieDrag {
  id: string
  over: string | null
}

function EntryRow({
  entry,
  scene,
  active,
  drag,
  onDrag,
}: {
  entry: InitiativeEntry
  scene: Scene
  active: boolean
  /** A reorder in progress: the entry being moved and the row under the pointer. */
  drag: TieDrag | null
  onDrag: (drag: TieDrag | null) => void
}) {
  const entries = scene.initiative.entries
  const shown = effectiveVisibility(entry, scene) === 'shown'
  const valueTie = entries.some((e) => e.id !== entry.id && e.value === entry.value)
  const exactTie = tiedWith(entries, entry).length > 1
  const dragged = drag ? entries.find((e) => e.id === drag.id) : undefined
  // Highlighted while a tied entry is dragged over this row (only exact ties reorder).
  const droppable =
    drag?.over === entry.id &&
    dragged !== undefined &&
    dragged.id !== entry.id &&
    dragged.value === entry.value &&
    dragged.dexTiebreak === entry.dexTiebreak
  const note = entryNote(entry, scene)
  const moving = drag?.id === entry.id
  return (
    <li
      data-entry-id={entry.id}
      aria-current={active ? 'step' : undefined}
      className={`rounded-md border px-1 py-1 ${active ? 'border-accent bg-surface-2' : 'border-transparent'} ${droppable ? 'outline outline-1 outline-dashed outline-accent' : ''}`}
    >
      <div className="flex items-center gap-1">
        <span aria-hidden className="w-3 shrink-0 text-center text-xs text-accent">
          {active ? '▶' : ''}
        </span>
        <div className="w-12 shrink-0">
          <CommitNumberInput
            aria-label={`Initiative of ${entry.name}`}
            value={entry.value}
            min={-MAX_INITIATIVE}
            max={MAX_INITIATIVE}
            step={1}
            onCommit={(value) => updateEntry(entry.id, { value })}
          />
        </div>
        <div className="min-w-0 flex-1">
          <CommitTextInput
            aria-label={`Name players see for ${entry.name}`}
            value={entry.name}
            maxLength={MAX_NAME_LENGTH}
            onCommit={(name) => updateEntry(entry.id, { name })}
          />
        </div>
        <IconButton
          icon={shown ? Eye : EyeOff}
          label={shown ? `Hide ${entry.name} from players` : `Show ${entry.name} to players`}
          pressed={!shown}
          onClick={() => toggleEntryVisibility(entry.id)}
        />
        <IconButton
          icon={X}
          label={`Remove ${entry.name} from initiative`}
          onClick={() => removeEntry(entry.id)}
        />
      </div>
      {(valueTie || note) && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-4 text-xs text-fg-muted">
          {exactTie && (
            <span
              role="button"
              tabIndex={0}
              aria-label={`Reorder ${entry.name} among tied entries`}
              title="Drag onto a tied entry, or use the arrow keys, to order exact ties"
              // A pointer drag (not HTML drag-and-drop): the grip captures the pointer and
              // the row under it is the drop target; only exact ties accept it.
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.preventDefault()
                event.currentTarget.setPointerCapture(event.pointerId)
                onDrag({ id: entry.id, over: null })
              }}
              onPointerMove={(event) => {
                if (!moving) return
                const row = document
                  .elementFromPoint(event.clientX, event.clientY)
                  ?.closest('[data-entry-id]')
                const over = row?.getAttribute('data-entry-id') ?? null
                if (over !== drag?.over) onDrag({ id: entry.id, over })
              }}
              onPointerUp={(event) => {
                // The row under the pointer now (the last move may not have rendered yet).
                const over = document
                  .elementFromPoint(event.clientX, event.clientY)
                  ?.closest('[data-entry-id]')
                  ?.getAttribute('data-entry-id')
                if (moving && over) moveAmongTies(entry.id, { targetId: over })
                onDrag(null)
              }}
              onPointerCancel={() => onDrag(null)}
              // The row re-rendered away mid-drag (an undo...): never leave the highlight stuck.
              onLostPointerCapture={() => {
                if (moving) onDrag(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                  event.preventDefault()
                  moveAmongTies(entry.id, { step: event.key === 'ArrowUp' ? -1 : 1 })
                }
              }}
              className={`touch-none rounded p-0.5 hover:bg-surface-3 hover:text-fg ${moving ? 'cursor-grabbing bg-surface-3 text-fg' : 'cursor-grab'}`}
            >
              <GripVertical aria-hidden className="size-3.5" />
            </span>
          )}
          {valueTie && (
            <span className="flex items-center gap-1">
              Tie, Dex
              <span className="w-12">
                <CommitNumberInput
                  aria-label={`Dex tiebreak of ${entry.name}`}
                  value={entry.dexTiebreak}
                  min={-MAX_INITIATIVE}
                  max={MAX_INITIATIVE}
                  step={1}
                  placeholder="–"
                  onCommit={(dexTiebreak) => updateEntry(entry.id, { dexTiebreak })}
                  onClear={() => updateEntry(entry.id, { dexTiebreak: null })}
                />
              </span>
            </span>
          )}
          {note && <span>{note}</span>}
        </div>
      )}
    </li>
  )
}

function AddByName() {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const nameId = useId()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const number = Number(value)
    if (addNamedEntry(name, value.trim() === '' || !Number.isFinite(number) ? 0 : number)) {
      setName('')
      setValue('')
    }
  }
  return (
    <form onSubmit={submit} className="flex items-center gap-1" aria-label="Add by name">
      <label htmlFor={nameId} className="sr-only">
        Name of a creature to add
      </label>
      <div className="min-w-0 flex-1">
        <input
          id={nameId}
          value={name}
          maxLength={MAX_NAME_LENGTH}
          placeholder="Add by name…"
          onChange={(event) => setName(event.target.value)}
          className={inputClass}
        />
      </div>
      <div className="w-16 shrink-0">
        <input
          type="number"
          aria-label="Its initiative"
          value={value}
          placeholder="Init"
          step={1}
          onChange={(event) => setValue(event.target.value)}
          className={inputClass}
        />
      </div>
      <button
        type="submit"
        className={buttonClass}
        disabled={name.trim() === ''}
        aria-label="Add to initiative"
        title="Add to initiative"
      >
        <Plus aria-hidden className="size-4" />
      </button>
    </form>
  )
}

async function confirmEnd(): Promise<void> {
  const ok = await confirmAction({
    title: 'End combat?',
    message: 'This clears the initiative tracker of this scene. You can undo it.',
    confirmLabel: 'End combat',
  })
  if (ok) endCombat()
}

export function InitiativePanel() {
  const scene = useActiveScene()
  const selection = useUiStore((s) => s.selection)
  const [open, setOpen] = useState(readOpen)
  const [drag, setDrag] = useState<TieDrag | null>(null)
  const tracker = scene.initiative
  const sorted = useMemo(() => sortInitiative(tracker.entries), [tracker.entries])
  const selectedTokens = scene.layers.tokens.filter((token) => selection.includes(token.id))
  const addable = tokensNotInInitiative(scene, selection).length
  const rollable = selectedTokens.filter((token) => token.kind !== 'player').length
  const started = tracker.activeEntryId !== null
  const toggleOpen = () => {
    setOpen(!open)
    writeOpen(!open)
  }

  return (
    <section aria-labelledby="initiative-heading" className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 id="initiative-heading" className="flex-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls="initiative-body"
            onClick={toggleOpen}
            className="flex items-center gap-1 text-xs font-semibold tracking-wider text-fg-muted uppercase hover:text-fg"
          >
            <ChevronDown
              aria-hidden
              className={`size-3.5 transition-transform ${open ? '' : '-rotate-90'}`}
            />
            Initiative
          </button>
        </h2>
        {tracker.entries.length > 0 && (
          <span className="text-xs text-fg-muted">Round {tracker.round}</span>
        )}
      </div>
      {open && (
        <div id="initiative-body" className="space-y-2">
          <Toggle
            checked={tracker.visibleToPlayers}
            onChange={setTrackerVisible}
            label="Show tracker to players"
          />
          <div className="flex items-center gap-1">
            <IconButton
              icon={ChevronLeft}
              label="Previous turn"
              title="Previous turn (Shift+N)"
              disabled={!started}
              onClick={() => previousTurn()}
            />
            <button
              type="button"
              onClick={() => nextTurn()}
              disabled={tracker.entries.length === 0}
              title="Next turn (N)"
              className={`${buttonClass} flex-1`}
            >
              {started ? 'Next turn' : 'Start combat'}
              <ChevronRight aria-hidden className="size-4" />
            </button>
            <IconButton
              icon={Crosshair}
              label="Center on active"
              title="Center the view on the active creature"
              disabled={activeToken(scene) === null}
              onClick={() => centerOnActiveToken()}
            />
          </div>
          {sorted.length > 0 ? (
            <ol aria-label="Turn order" className="space-y-0.5">
              {sorted.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  scene={scene}
                  active={entry.id === tracker.activeEntryId}
                  drag={drag}
                  onDrag={setDrag}
                />
              ))}
            </ol>
          ) : (
            <p className="text-xs text-fg-muted">
              Select tokens and add them, or add creatures by name. Values sort the order; players
              see names only.
            </p>
          )}
          <AddByName />
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className={buttonClass}
              disabled={addable === 0}
              onClick={() => addTokensToInitiative(selection)}
            >
              <Swords aria-hidden className="size-4" />
              Add selected{addable > 0 ? ` (${addable})` : ''}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={rollable === 0}
              title="d20 + initiative modifier for the selected NPCs and enemies"
              onClick={() => rollInitiative(selection)}
            >
              <Dices aria-hidden className="size-4" />
              Roll for selected
            </button>
          </div>
          {tracker.entries.length > 0 && (
            <button type="button" className={dangerButtonClass} onClick={() => void confirmEnd()}>
              End combat…
            </button>
          )}
        </div>
      )}
    </section>
  )
}
