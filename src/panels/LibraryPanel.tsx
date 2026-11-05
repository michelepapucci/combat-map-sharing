import { CloudOff, Pencil, Search, Upload } from 'lucide-react'
import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
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
import { IMAGE_MIMES } from '../assets/upload/plan'
import { readableOn } from '../canvas/color'
import { LIBRARY_MIME, placeLibraryEntry, type LibraryEntry } from '../dm/placement'
import { useThumbnailUrl } from '../dm/thumbnails'
import { importImageFiles } from '../dm/uploads'
import { autoBadge } from '../state/naming'
import { FOOTPRINT_CELLS, type AssetKind, type AssetMeta } from '../state/types'
import { useCampaign } from '../store/campaign'
import { useUiStore } from '../store/ui'
import { buttonClass, inputClass, SectionHeading } from '../ui/controls'

const TABS = [
  { id: 'tokens', label: 'Tokens', kind: 'token' },
  { id: 'props', label: 'Props', kind: 'prop' },
  { id: 'maps', label: 'Maps', kind: 'map' },
] as const satisfies readonly { id: string; label: string; kind: AssetKind }[]
type Tab = (typeof TABS)[number]

const ACCEPT = IMAGE_MIMES.join(',')

function startDrag(event: DragEvent, entry: LibraryEntry) {
  event.dataTransfer.setData(LIBRARY_MIME, JSON.stringify(entry))
  event.dataTransfer.effectAllowed = 'copy'
}

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer.types.includes('Files')
}

/** Case-insensitive match on the name or any tag. */
function matches(query: string, name: string, tags: readonly string[] = []): boolean {
  const q = query.trim().toLowerCase()
  return q === '' || name.toLowerCase().includes(q) || tags.some((tag) => tag.includes(q))
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

const PLACE_HINT = 'Click to place in the middle of the view, or drag onto the map.'

function ColorPicker() {
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
              swatch.value === null ? 'By kind: blue players, green NPCs, red enemies' : swatch.name
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
  )
}

function PresetGrid({ query }: { query: string }) {
  const tokenColor = useUiStore((s) => s.tokenColor)
  const presets = TOKEN_PRESETS.filter((preset) => matches(query, preset.name, [preset.kind]))
  if (presets.length === 0) return null
  return (
    <ul className="grid grid-cols-3 gap-1">
      {presets.map((preset) => (
        <li key={preset.id}>
          <button
            type="button"
            draggable
            onDragStart={(event) => startDrag(event, { type: 'preset', presetId: preset.id })}
            onClick={() => placeLibraryEntry({ type: 'preset', presetId: preset.id }, null)}
            title={`${preset.name} (${preset.kind}, ${sizeLabel(preset)}). ${PLACE_HINT}`}
            className={tileClass}
          >
            <TokenPreview preset={preset} color={tokenColor ?? KIND_COLORS[preset.kind]} />
            <span className="w-full truncate">{preset.name}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function BuiltinImageGrid({
  assets,
  columns,
}: {
  assets: readonly BuiltinImageAsset[]
  columns: 2 | 3
}) {
  if (assets.length === 0) return null
  return (
    <ul className={`grid gap-1 ${columns === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {assets.map((asset) => (
        <li key={asset.id}>
          <button
            type="button"
            draggable
            onDragStart={(event) => startDrag(event, { type: 'asset', assetId: asset.id })}
            onClick={() => placeLibraryEntry({ type: 'asset', assetId: asset.id }, null)}
            title={`${asset.name}. ${PLACE_HINT}`}
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

function UploadThumbnail({ asset }: { asset: AssetMeta }) {
  const url = useThumbnailUrl(asset.id)
  const tokenColor = useUiStore((s) => s.tokenColor)
  if (asset.kind === 'token') {
    const ring = tokenColor ?? KIND_COLORS[asset.defaultKind ?? 'enemy']
    return (
      <span
        className="block size-10 overflow-hidden rounded-full border-[3px] bg-surface-3"
        style={{ borderColor: ring }}
      >
        {url && <img src={url} alt="" draggable={false} className="size-full object-cover" />}
      </span>
    )
  }
  return (
    <span
      className={`block w-full overflow-hidden rounded bg-surface-3 ${asset.kind === 'map' ? 'aspect-[4/3]' : 'aspect-square'}`}
    >
      {url && (
        <img
          src={url}
          alt=""
          draggable={false}
          className={`size-full ${asset.kind === 'map' ? 'object-cover' : 'object-contain'}`}
        />
      )}
    </span>
  )
}

function UploadGrid({ assets, columns }: { assets: readonly AssetMeta[]; columns: 2 | 3 }) {
  return (
    <ul className={`grid gap-1 ${columns === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {assets.map((asset) => (
        <li key={asset.id} className="group relative">
          <button
            type="button"
            draggable
            onDragStart={(event) => startDrag(event, { type: 'asset', assetId: asset.id })}
            onClick={() => placeLibraryEntry({ type: 'asset', assetId: asset.id }, null)}
            title={`${asset.name}${asset.tags.length > 0 ? ` (${asset.tags.join(', ')})` : ''}. ${PLACE_HINT}`}
            className={tileClass}
          >
            <UploadThumbnail asset={asset} />
            <span className="flex w-full items-center justify-center gap-1">
              {asset.localOnly && (
                <CloudOff
                  aria-label="Kept on this device only"
                  className="size-3 shrink-0 text-fg-muted"
                />
              )}
              <span className="truncate">{asset.name}</span>
            </span>
          </button>
          <button
            type="button"
            aria-label={`Edit ${asset.name}`}
            title="Rename, tags, default size, delete"
            onClick={() => useUiStore.setState({ editingAssetId: asset.id })}
            className="absolute top-1 right-1 rounded-md bg-surface/90 p-1 text-fg-muted opacity-60 shadow group-hover:opacity-100 hover:text-fg focus-visible:opacity-100"
          >
            <Pencil aria-hidden className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  )
}

function TabContent({ tab, query }: { tab: Tab; query: string }) {
  const library = useCampaign((c) => c.library)
  const uploads = library.filter(
    (asset) => asset.kind === tab.kind && matches(query, asset.name, asset.tags),
  )
  const anyUploads = library.some((asset) => asset.kind === tab.kind)
  const columns = tab.kind === 'map' ? 2 : 3
  const builtin =
    tab.kind === 'token' ? (
      <PresetGrid query={query} />
    ) : (
      <BuiltinImageGrid
        assets={(tab.kind === 'map' ? MAP_ASSETS : PROP_ASSETS).filter((a) =>
          matches(query, a.name),
        )}
        columns={columns}
      />
    )
  const builtinCount =
    tab.kind === 'token'
      ? TOKEN_PRESETS.filter((p) => matches(query, p.name, [p.kind])).length
      : (tab.kind === 'map' ? MAP_ASSETS : PROP_ASSETS).filter((a) => matches(query, a.name)).length
  return (
    <div className="space-y-3">
      {tab.kind === 'token' && <ColorPicker />}
      {uploads.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-xs text-fg-muted">Your images</h3>
          <UploadGrid assets={uploads} columns={columns} />
        </div>
      )}
      {builtinCount > 0 && (
        <div className="space-y-1">
          {anyUploads && <h3 className="text-xs text-fg-muted">Built-in</h3>}
          {builtin}
        </div>
      )}
      {uploads.length === 0 && builtinCount === 0 && (
        <p className="py-2 text-center text-sm text-fg-muted">Nothing matches “{query.trim()}”.</p>
      )}
    </div>
  )
}

/**
 * Library (SPEC §5.2): built-in tokens, props and maps plus the DM's uploads,
 * searchable by name and tag. Upload with the button or by dropping files on
 * the panel; uploads go to the open tab's kind.
 */
export function LibraryPanel() {
  const [tabId, setTabId] = useState<Tab['id']>('tokens')
  const [query, setQuery] = useState('')
  const [dropping, setDropping] = useState(false)
  const importing = useUiStore((s) => s.importProgress !== null)
  const fileInput = useRef<HTMLInputElement>(null)
  const tab = TABS.find((t) => t.id === tabId) ?? TABS[0]

  const onTabKey = (event: KeyboardEvent) => {
    const index = TABS.findIndex((t) => t.id === tabId)
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (delta === 0) return
    // Arrow keys switch tabs here; they must not also nudge the selection.
    event.preventDefault()
    const next = TABS[(index + delta + TABS.length) % TABS.length]
    if (!next) return
    setTabId(next.id)
    document.getElementById(`library-tab-${next.id}`)?.focus()
  }

  const upload = (files: FileList | null) => {
    if (files && files.length > 0) void importImageFiles([...files], tab.kind, { review: true })
  }

  return (
    // The whole panel accepts dropped image files; the Upload button does the same from the keyboard.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- file drop target only
    <section
      aria-labelledby="library-heading"
      className={`space-y-2 rounded-lg ${dropping ? 'outline-2 outline-offset-4 outline-accent outline-dashed' : ''}`}
      onDragOver={(event) => {
        if (!hasFiles(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setDropping(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return
        event.preventDefault()
        setDropping(false)
        upload(event.dataTransfer.files)
      }}
    >
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
            aria-selected={tabId === t.id}
            aria-controls={tabId === t.id ? `library-panel-${t.id}` : undefined}
            tabIndex={tabId === t.id ? 0 : -1}
            onClick={() => setTabId(t.id)}
            onKeyDown={onTabKey}
            className="flex-1 rounded-md px-2 py-1 text-sm text-fg-muted aria-selected:bg-surface-3 aria-selected:text-fg"
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        <label className="relative min-w-0 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-fg-muted"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={`Search ${tab.label.toLowerCase()} by name or tag`}
            placeholder="Search name or tag"
            className={`${inputClass} pl-7`}
          />
        </label>
        <button
          type="button"
          className={buttonClass}
          disabled={importing}
          onClick={() => fileInput.current?.click()}
          title={`Upload ${tab.label.toLowerCase()} (PNG, JPEG or WebP). You can also drop files here.`}
        >
          <Upload aria-hidden className="size-4" />
          Upload
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          aria-label={`Upload ${tab.label.toLowerCase()}`}
          onChange={(event) => {
            upload(event.target.files)
            event.target.value = ''
          }}
        />
      </div>
      <div id={`library-panel-${tab.id}`} role="tabpanel" aria-labelledby={`library-tab-${tab.id}`}>
        <TabContent tab={tab} query={query} />
      </div>
      <p className="text-xs text-fg-muted">{PLACE_HINT}</p>
    </section>
  )
}
