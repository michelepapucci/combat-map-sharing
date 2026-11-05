import { Minus, Plus, TriangleAlert, X } from 'lucide-react'
import { useId, useState } from 'react'
import { fogRegionAt, visionRadiusPx, visionSources } from '../geometry/fog'
import { fromDisplayLength, toDisplayLength, unitSymbol } from '../geometry/units'
import { MAX_NAME_LENGTH, MAX_NOTES_LENGTH, MAX_TAG_LENGTH } from '../state/validate'
import { STANDARD_CONDITIONS, type Scene, type Token } from '../state/types'
import { DEFAULT_PLAYER_VISION_FT, MAX_VISION_FT, updateItem } from '../store/actions'
import { useActiveScene, useCampaign } from '../store/campaign'
import {
  buttonClass,
  CommitNumberInput,
  CommitTextarea,
  CommitTextInput,
  Field,
  inputClass,
  Toggle,
} from '../ui/controls'

/**
 * Token properties beyond the basics (SPEC §5.3): label, vision, hit points,
 * conditions and DM notes. What players can see is said next to each field.
 */

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function LabelFields({ token }: { token: Token }) {
  return (
    <div className="space-y-1.5">
      <Field label="Label (players see it under the token)">
        <CommitTextInput
          key={token.id}
          value={token.label ?? ''}
          maxLength={MAX_NAME_LENGTH}
          placeholder="e.g. Hooded figure"
          onCommit={(label) => updateItem(token.id, { label })}
        />
      </Field>
      <Toggle
        checked={token.showLabel}
        onChange={(showLabel) => updateItem(token.id, { showLabel })}
        label="Show the label to players"
      />
    </div>
  )
}

/** The radius a token had before its vision was turned off, so turning it on restores it (this session). */
const visionBeforeOff = new Map<string, number>()

/** What a token's vision does for players right now, and if nothing, why (and how to fix it). */
function visionStatus(
  token: Token,
  scene: Scene,
  npcVision: boolean,
): { ok: boolean; text: string } | null {
  if (token.visionFt === null) {
    return token.kind === 'player'
      ? { ok: false, text: 'No vision: this hero reveals no fog.' }
      : null
  }
  // The token's own problems first: they matter as soon as fog goes on.
  if (token.kind === 'enemy') {
    return { ok: false, text: 'Enemies never reveal fog. Set Kind to Player for a hero.' }
  }
  if (token.kind === 'npc' && !npcVision) {
    return {
      ok: false,
      text: 'NPCs reveal fog only when “NPC allies … reveal fog too” is on in Settings.',
    }
  }
  if (token.hidden) return { ok: false, text: 'Hidden tokens reveal no fog.' }
  if (!scene.layerState.tokens.visible) {
    return { ok: false, text: 'The tokens layer is hidden, so no token reveals fog.' }
  }
  if (!scene.fog.enabled) {
    return { ok: true, text: 'Fog is off in this scene: players see everything.' }
  }
  const circle = { x: token.x, y: token.y, r: visionRadiusPx(token.visionFt, scene.grid) }
  const rules = { enabled: true, exploredEnabled: false, manual: scene.fog.manual }
  if (fogRegionAt(token, rules, [circle], null) === 'dark') {
    return token.kind === 'npc'
      ? { ok: false, text: 'A manual hide covers this NPC, so it gives no vision.' }
      : { ok: false, text: 'A manual hide covers this token: it stays black there despite vision.' }
  }
  const source = visionSources(scene, { npcVision }).some((s) => s.tokenId === token.id)
  return source
    ? { ok: true, text: 'Reveals fog for players.' }
    : { ok: false, text: 'Reveals no fog.' }
}

function VisionField({ token }: { token: Token }) {
  const scene = useActiveScene()
  const units = useCampaign((c) => c.settings.units)
  const npcVision = useCampaign((c) => c.settings.npcVision)
  const symbol = unitSymbol(units)
  const status = visionStatus(token, scene, npcVision)
  const toggle = (on: boolean) => {
    if (on) {
      updateItem(token.id, { visionFt: visionBeforeOff.get(token.id) ?? DEFAULT_PLAYER_VISION_FT })
      return
    }
    if (token.visionFt !== null) visionBeforeOff.set(token.id, token.visionFt)
    updateItem(token.id, { visionFt: null })
  }
  return (
    <div className="space-y-1.5">
      <Toggle checked={token.visionFt !== null} onChange={toggle} label="Vision" />
      {token.visionFt !== null && (
        <Field label={`Vision radius (${symbol})`}>
          <CommitNumberInput
            value={toDisplayLength(token.visionFt, units)}
            min={0}
            max={toDisplayLength(MAX_VISION_FT, units)}
            step={units === 'metric' ? 1.5 : 5}
            onCommit={(value) => {
              if (!(value > 0) && token.visionFt !== null) {
                visionBeforeOff.set(token.id, token.visionFt)
              }
              updateItem(token.id, { visionFt: value > 0 ? fromDisplayLength(value, units) : null })
            }}
          />
        </Field>
      )}
      {status && (
        <p
          className={`flex items-start gap-1.5 text-xs ${status.ok ? 'text-fg-muted' : 'text-fg'}`}
        >
          {!status.ok && (
            <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-accent" />
          )}
          {status.text}
        </p>
      )}
    </div>
  )
}

const hpButton =
  'flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-fg hover:bg-surface-3'

function HpFields({ token }: { token: Token }) {
  const hp = token.hp
  if (!hp) {
    return (
      <button
        type="button"
        className={buttonClass}
        onClick={() => updateItem(token.id, { hp: { current: 10, max: 10, publicBar: false } })}
      >
        <Plus aria-hidden className="size-4" />
        Track hit points
      </button>
    )
  }
  const change = (delta: number) =>
    updateItem(
      token.id,
      { hp: { ...hp, current: hp.current + delta } },
      { coalesceKey: `hp:${token.id}` },
    )
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1 text-xs text-fg-muted">Hit points (numbers are DM only)</legend>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className={hpButton}
          aria-label="Lose 1 hit point"
          title="−1 HP (Shift: −5)"
          onClick={(event) => change(event.shiftKey ? -5 : -1)}
        >
          <Minus aria-hidden className="size-4" />
        </button>
        <div className="w-16">
          <CommitNumberInput
            aria-label="Current hit points"
            value={hp.current}
            step={1}
            onCommit={(current) => updateItem(token.id, { hp: { ...hp, current } })}
          />
        </div>
        <button
          type="button"
          className={hpButton}
          aria-label="Gain 1 hit point"
          title="+1 HP (Shift: +5)"
          onClick={(event) => change(event.shiftKey ? 5 : 1)}
        >
          <Plus aria-hidden className="size-4" />
        </button>
        <span className="text-fg-muted">/</span>
        <div className="w-16">
          <CommitNumberInput
            aria-label="Maximum hit points"
            value={hp.max}
            min={1}
            step={1}
            onCommit={(max) => updateItem(token.id, { hp: { ...hp, max } })}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Toggle
          checked={hp.publicBar}
          onChange={(publicBar) => updateItem(token.id, { hp: { ...hp, publicBar } })}
          label="Players see an HP bar"
        />
        <button
          type="button"
          className="text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline"
          onClick={() => updateItem(token.id, { hp: null })}
        >
          Stop tracking
        </button>
      </div>
    </fieldset>
  )
}

function ConditionsField({ token }: { token: Token }) {
  const [draft, setDraft] = useState('')
  const listId = useId()
  const inputId = useId()
  const add = () => {
    const condition = draft.trim()
    if (condition === '') return
    updateItem(token.id, { conditions: [...token.conditions, condition] })
    setDraft('')
  }
  const remove = (condition: string) =>
    updateItem(token.id, { conditions: token.conditions.filter((c) => c !== condition) })
  const present = new Set(token.conditions.map((c) => c.toLowerCase()))
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="text-xs text-fg-muted">
        Conditions (players see them)
      </label>
      {token.conditions.length > 0 && (
        <ul aria-label="Conditions" className="flex flex-wrap gap-1">
          {token.conditions.map((condition) => (
            <li
              key={condition}
              className="flex items-center gap-1 rounded-full bg-surface-3 py-0.5 pr-1 pl-2.5 text-xs"
            >
              {capitalize(condition)}
              <button
                type="button"
                aria-label={`Remove ${condition}`}
                title={`Remove ${condition}`}
                onClick={() => remove(condition)}
                className="rounded-full p-0.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1.5">
        <input
          id={inputId}
          list={listId}
          value={draft}
          maxLength={MAX_TAG_LENGTH}
          placeholder="Add: prone, poisoned, or your own"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
          className={inputClass}
        />
        <button type="button" className={buttonClass} onClick={add} disabled={draft.trim() === ''}>
          Add
        </button>
        <datalist id={listId}>
          {STANDARD_CONDITIONS.filter((c) => !present.has(c)).map((condition) => (
            <option key={condition} value={condition} aria-label={condition} />
          ))}
        </datalist>
      </div>
    </div>
  )
}

/** The token-only fields of the properties panel. */
export function TokenDetails({ token }: { token: Token }) {
  return (
    <div className="space-y-3">
      <LabelFields token={token} />
      <VisionField token={token} />
      {token.kind !== 'player' && (
        <Field label="Initiative modifier (Roll for selected adds it to d20)">
          <CommitNumberInput
            value={token.initiativeModifier}
            min={-99}
            max={99}
            step={1}
            placeholder="+0"
            onCommit={(initiativeModifier) => updateItem(token.id, { initiativeModifier })}
            onClear={() => updateItem(token.id, { initiativeModifier: null })}
          />
        </Field>
      )}
      <HpFields token={token} />
      <ConditionsField token={token} />
      <Field label="DM notes (never shown to players)">
        <CommitTextarea
          key={token.id}
          value={token.dmNotes}
          maxLength={MAX_NOTES_LENGTH}
          placeholder="Tactics, loot, secrets…"
          onCommit={(dmNotes) => updateItem(token.id, { dmNotes })}
        />
      </Field>
    </div>
  )
}
