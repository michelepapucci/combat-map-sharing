import { CloudOff, Trash } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { confirmAction } from '../dm/confirm'
import { useThumbnailUrl } from '../dm/thumbnails'
import { deleteUploadedAsset } from '../dm/uploads'
import { MAX_DEFAULT_CELLS } from '../state/validate'
import {
  ASSET_KINDS,
  SIZE_CATEGORIES,
  TOKEN_KINDS,
  type AssetKind,
  type AssetMeta,
  type SizeCategory,
  type TokenKind,
} from '../state/types'
import { useCampaignStore } from '../store/campaign'
import {
  assetUsage,
  MAX_ASSET_NAME,
  parseTags,
  updateAsset,
  type AssetUsage,
} from '../store/libraryActions'
import { useUiStore } from '../store/ui'
import {
  buttonClass,
  dangerButtonClass,
  Field,
  inputClass,
  primaryButtonClass,
} from '../ui/controls'
import { Dialog } from '../ui/Dialog'
import { defaultCellsFor } from '../assets/upload/plan'

const KIND_LABEL: Record<AssetKind, string> = { token: 'Token', prop: 'Prop', map: 'Map' }
const TOKEN_KIND_LABEL: Record<TokenKind, string> = {
  player: 'Player',
  npc: 'NPC',
  enemy: 'Enemy',
}

function close() {
  useUiStore.setState({ editingAssetId: null })
}

function formatBytes(bytes: number): string {
  return bytes < 1_000_000
    ? `${Math.max(1, Math.round(bytes / 1000))} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`
}

function plural(n: number, one: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${one}s`
}

function deletionMessage(name: string, usage: AssetUsage): string {
  const lines = [`“${name}” will be deleted from this browser. This cannot be undone.`]
  if (usage.items > 0) {
    lines.push(
      `It is used by ${plural(usage.items, 'item')} in ${plural(usage.scenes, 'scene')}: they will be removed too, and undo history will be cleared.`,
    )
  } else if (usage.inHistory) {
    lines.push('Undo history could bring back items that use it, so it will be cleared.')
  }
  if (usage.splash) lines.push('It is also the blackout splash image.')
  return lines.join('\n\n')
}

function clampCells(value: string): number {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.min(MAX_DEFAULT_CELLS, Math.max(1, n)) : 1
}

function AssetForm({ asset }: { asset: AssetMeta }) {
  const thumbnail = useThumbnailUrl(asset.id)
  const fallbackCells = asset.defaultCells ?? defaultCellsFor(asset.width, asset.height)
  const [name, setName] = useState(asset.name)
  const [tags, setTags] = useState(asset.tags.join(', '))
  const [kind, setKind] = useState<AssetKind>(asset.kind)
  const [size, setSize] = useState<SizeCategory>(asset.defaultSize ?? 'medium')
  const [tokenKind, setTokenKind] = useState<TokenKind>(asset.defaultKind ?? 'enemy')
  const [cellsW, setCellsW] = useState(String(fallbackCells.w))
  const [cellsH, setCellsH] = useState(String(fallbackCells.h))

  const save = (event: FormEvent) => {
    event.preventDefault()
    updateAsset(asset.id, {
      name,
      tags: parseTags(tags),
      kind,
      defaultSize: kind === 'token' ? size : null,
      defaultKind: kind === 'token' ? tokenKind : null,
      defaultCells: kind === 'prop' ? { w: clampCells(cellsW), h: clampCells(cellsH) } : null,
    })
    close()
  }

  const askDelete = async () => {
    const confirmed = await confirmAction({
      title: 'Delete image?',
      message: deletionMessage(asset.name, assetUsage(asset.id)),
      confirmLabel: 'Delete image',
    })
    if (!confirmed) return
    close()
    await deleteUploadedAsset(asset.id)
  }

  return (
    <form id="asset-form" onSubmit={save} className="space-y-4">
      <div className="flex gap-3">
        <span className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-3">
          {thumbnail && <img src={thumbnail} alt="" className="max-h-full max-w-full" />}
        </span>
        <div className="space-y-1 text-xs text-fg-muted">
          <p>
            {asset.width} × {asset.height} px · {formatBytes(asset.bytes)} ·{' '}
            {asset.mime.replace('image/', '').toUpperCase()}
          </p>
          {asset.localOnly && (
            <p className="flex items-start gap-1.5 text-fg">
              <CloudOff aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              Too large to sync to a gist even after compression: it stays in this browser.
            </p>
          )}
        </div>
      </div>
      <Field label="Name">
        <input
          className={inputClass}
          value={name}
          maxLength={MAX_ASSET_NAME}
          required
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field label="Tags (comma-separated, for search)">
        <input
          className={inputClass}
          value={tags}
          placeholder="e.g. forest, night"
          onChange={(event) => setTags(event.target.value)}
        />
      </Field>
      <Field label="Type">
        <select
          className={inputClass}
          value={kind}
          onChange={(event) => setKind(event.target.value as AssetKind)}
        >
          {ASSET_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </Field>
      {kind === 'token' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default size">
            <select
              className={inputClass}
              value={size}
              onChange={(event) => setSize(event.target.value as SizeCategory)}
            >
              {SIZE_CATEGORIES.map((s) => (
                <option key={s} value={s}>
                  {s[0]?.toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Default kind">
            <select
              className={inputClass}
              value={tokenKind}
              onChange={(event) => setTokenKind(event.target.value as TokenKind)}
            >
              {TOKEN_KINDS.map((k) => (
                <option key={k} value={k}>
                  {TOKEN_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {kind === 'prop' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default width (cells)">
            <input
              className={inputClass}
              type="number"
              min={1}
              max={MAX_DEFAULT_CELLS}
              step={1}
              value={cellsW}
              onChange={(event) => setCellsW(event.target.value)}
            />
          </Field>
          <Field label="Default height (cells)">
            <input
              className={inputClass}
              type="number"
              min={1}
              max={MAX_DEFAULT_CELLS}
              step={1}
              value={cellsH}
              onChange={(event) => setCellsH(event.target.value)}
            />
          </Field>
        </div>
      )}
      {kind === 'map' && (
        <p className="text-xs text-fg-muted">
          Maps are placed at their native size; then calibrate the grid.
        </p>
      )}
      <p className="text-xs text-fg-muted">Changes apply to items placed from now on.</p>
      <div className="flex">
        <button type="button" className={dangerButtonClass} onClick={() => void askDelete()}>
          <Trash aria-hidden className="size-4" />
          Delete image…
        </button>
      </div>
    </form>
  )
}

/** Edits an uploaded asset (SPEC §5.2): name, tags, type, default size; delete with an in-use warning. */
export function AssetDialog() {
  const id = useUiStore((s) => s.editingAssetId)
  const asset = useCampaignStore((s) => s.campaign?.library.find((a) => a.id === id) ?? null)
  if (!asset) return null
  return (
    <Dialog
      key={asset.id}
      title="Edit image"
      onClose={close}
      footer={
        <>
          <button type="button" className={buttonClass} onClick={close}>
            Cancel
          </button>
          <button type="submit" form="asset-form" className={primaryButtonClass}>
            Save
          </button>
        </>
      }
    >
      <AssetForm asset={asset} />
    </Dialog>
  )
}
