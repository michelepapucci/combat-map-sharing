import { useState, type DragEvent, type KeyboardEvent } from 'react'
import { GLYPHS } from '../assets/builtin/glyphs'
import {
  builtinThumbnailUrl,
  KIND_COLORS,
  MAP_ASSETS,
  PROP_ASSETS,
  TOKEN_COLORS,
  TOKEN_PRESETS,
  tokenLook,
  type BuiltinImageAsset,
  type TokenPreset,
} from '../assets/builtin/registry'
import { readableOn } from '../canvas/color'
import { LIBRARY_MIME, placeLibraryEntry, type LibraryEntry } from '../dm/placement'
import { autoBadge } from '../state/naming'
import { FOOTPRINT_CELLS } from '../state/types'
import { useUiStore } from '../store/ui'
import { SectionHeading } from '../ui/controls'

const TABS = [
  { id: 'tokens', label: 'Tokens' },
  { id: 'props', label: 'Props' },
  { id: 'maps', label: 'Maps' },
] as const
type TabId = (typeof TABS)[number]['id']

function startDrag(event: DragEvent, entry: LibraryEntry) {
  event.dataTransfer.setData(LIBRARY_MIME, JSON.stringify(entry))
  event.dataTransfer.effectAllowed = 'copy'
}

function TokenPreview({ preset, color }: { preset: TokenPreset; color: string }) {
  const look = tokenLook(preset.assetId)
  const foreground = readableOn(color)
  const badge = autoBadge('initials', `${preset.name} 1`) ?? ''
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-10">
      <circle cx="12" cy="12" r="11.2" fill={color} stroke="#0b0d12" strokeWidth="0.8" />
      {look?.type === 'glyph' ? (
        <g transform="translate(12 12) scale(0.58) translate(-12 -12)">
          {GLYPHS[look.glyph].map((part, i) => (
            <path
              key={i}
              d={part.d}
              fill={foreground}
              fillRule={part.evenodd ? 'evenodd' : 'nonzero'}
            />
          ))}
        </g>
      ) : (
        <text
          x="12"
          y="12.5"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={badge.length > 2 ? 7 : 9}
          fontWeight="700"
          fill={foreground}
        >
          {badge}
        </text>
      )}
    </svg>
  )
}

const tileClass =
  'flex w-full flex-col items-center gap-1 rounded-lg border border-transparent p-1.5 text-center text-xs hover:border-border hover:bg-surface-2 focus-visible:border-accent'

function sizeLabel(preset: TokenPreset): string {
  const cells = FOOTPRINT_CELLS[preset.sizeCategory]
  const name = preset.sizeCategory[0]?.toUpperCase() + preset.sizeCategory.slice(1)
  return cells > 1 ? `${name}, ${cells}×${cells}` : name
}

function TokensTab() {
  const tokenColor = useUiStore((s) => s.tokenColor)
  const swatches = [{ name: 'By kind', value: null }, ...TOKEN_COLORS]
  const onSwatchKey = (event: KeyboardEvent, index: number) => {
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0
    if (delta === 0) return
    event.preventDefault()
    const next = swatches[(index + delta + swatches.length) % swatches.length]
    if (next) useUiStore.setState({ tokenColor: next.value })
    const buttons = event.currentTarget.parentElement?.querySelectorAll('button')
    buttons?.item((index + delta + swatches.length) % swatches.length)?.focus()
  }
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Color for new tokens" className="flex flex-wrap gap-1.5">
        {swatches.map((swatch, index) => {
          const checked = tokenColor === swatch.value
          return (
            <button
              key={swatch.name}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              title={
                swatch.value === null
                  ? 'By kind: blue players, green NPCs, red enemies'
                  : swatch.name
              }
              aria-label={swatch.name}
              onClick={() => useUiStore.setState({ tokenColor: swatch.value })}
              onKeyDown={(event) => onSwatchKey(event, index)}
              className="flex size-6 items-center justify-center rounded-full border-2 border-transparent aria-checked:border-fg"
            >
              {swatch.value === null ? (
                <span className="flex size-4 overflow-hidden rounded-full">
                  <span className="flex-1" style={{ background: KIND_COLORS.player }} />
                  <span className="flex-1" style={{ background: KIND_COLORS.npc }} />
                  <span className="flex-1" style={{ background: KIND_COLORS.enemy }} />
                </span>
              ) : (
                <span className="size-4 rounded-full" style={{ background: swatch.value }} />
              )}
            </button>
          )
        })}
      </div>
      <ul className="grid grid-cols-3 gap-1">
        {TOKEN_PRESETS.map((preset) => (
          <li key={preset.id}>
            <button
              type="button"
              draggable
              onDragStart={(event) => startDrag(event, { type: 'token', presetId: preset.id })}
              onClick={() => placeLibraryEntry({ type: 'token', presetId: preset.id }, null)}
              title={`${preset.name} (${preset.kind}, ${sizeLabel(preset)}). Click to place in the middle of the view, or drag onto the map.`}
              className={tileClass}
            >
              <TokenPreview preset={preset} color={tokenColor ?? KIND_COLORS[preset.kind]} />
              <span className="w-full truncate">{preset.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ImageGrid({ assets, columns }: { assets: readonly BuiltinImageAsset[]; columns: 2 | 3 }) {
  return (
    <ul className={`grid gap-1 ${columns === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {assets.map((asset) => (
        <li key={asset.id}>
          <button
            type="button"
            draggable
            onDragStart={(event) => startDrag(event, { type: 'image', assetId: asset.id })}
            onClick={() => placeLibraryEntry({ type: 'image', assetId: asset.id }, null)}
            title={`${asset.name}. Click to place in the middle of the view, or drag onto the map.`}
            className={tileClass}
          >
            <img
              src={builtinThumbnailUrl(asset)}
              alt=""
              draggable={false}
              className={`w-full rounded object-contain ${asset.kind === 'map' ? 'aspect-[4/3] object-cover' : 'aspect-square'}`}
            />
            <span className="w-full truncate">{asset.name}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Library (SPEC §5.2): built-in tokens, props and maps. Uploads arrive in milestone 3. */
export function LibraryPanel() {
  const [tab, setTab] = useState<TabId>('tokens')
  const onTabKey = (event: KeyboardEvent) => {
    const index = TABS.findIndex((t) => t.id === tab)
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (delta === 0) return
    // Arrow keys switch tabs here; they must not also nudge the selection.
    event.preventDefault()
    const next = TABS[(index + delta + TABS.length) % TABS.length]
    if (!next) return
    setTab(next.id)
    document.getElementById(`library-tab-${next.id}`)?.focus()
  }
  return (
    <section aria-labelledby="library-heading" className="space-y-2">
      <SectionHeading id="library-heading">Library</SectionHeading>
      <div
        role="tablist"
        aria-label="Asset types"
        className="flex gap-1 rounded-lg bg-surface-2 p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`library-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={tab === t.id ? `library-panel-${t.id}` : undefined}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={onTabKey}
            className="flex-1 rounded-md px-2 py-1 text-sm text-fg-muted aria-selected:bg-surface-3 aria-selected:text-fg"
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id={`library-panel-${tab}`} role="tabpanel" aria-labelledby={`library-tab-${tab}`}>
        {tab === 'tokens' && <TokensTab />}
        {tab === 'props' && <ImageGrid assets={PROP_ASSETS} columns={3} />}
        {tab === 'maps' && <ImageGrid assets={MAP_ASSETS} columns={2} />}
      </div>
      <p className="text-xs text-fg-muted">
        Click to place in the middle of the view, or drag onto the map.
      </p>
    </section>
  )
}
