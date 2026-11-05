import { LoaderCircle, Maximize, Minus, Plus, ScanEye, Upload, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { IMAGE_MIMES } from '../../assets/upload/plan'
import { builtinThumbnailUrl, MAP_ASSETS } from '../../assets/builtin/registry'
import { clampZoom, fitRect, zoomAt } from '../../geometry/camera'
import { contentBounds } from '../../store/actions'
import { useActiveScene } from '../../store/campaign'
import { setTool, useUiStore } from '../../store/ui'
import { setSceneFog, type FogBrushShape } from '../../store/fogActions'
import { placeLibraryEntry } from '../placement'
import { PreviewInitiative } from './FogViews'
import { importAndPlace } from '../uploads'
import { buttonClass, CommitNumberInput } from '../../ui/controls'

const hudButton =
  'flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg'

function zoomBy(factor: number): void {
  const { dmCamera, dmViewport } = useUiStore.getState()
  const center = { x: dmViewport.width / 2, y: dmViewport.height / 2 }
  useUiStore.setState({ dmCamera: zoomAt(dmCamera, dmViewport, center, dmCamera.zoom * factor) })
}

function ZoomControls() {
  const zoom = useUiStore((s) => s.dmCamera.zoom)
  const scene = useActiveScene()
  const fit = () => {
    const { dmViewport, dmCamera } = useUiStore.getState()
    const bounds = contentBounds(scene)
    useUiStore.setState({
      dmCamera: bounds
        ? fitRect(bounds, dmViewport)
        : { x: 0, y: 0, zoom: clampZoom(dmCamera.zoom) },
    })
  }
  return (
    <div
      role="group"
      aria-label="Zoom"
      className="pointer-events-auto absolute right-3 bottom-3 flex items-center gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-lg"
    >
      <button
        type="button"
        className={hudButton}
        onClick={() => zoomBy(1 / 1.25)}
        aria-label="Zoom out"
        title="Zoom out (mouse wheel)"
      >
        <Minus aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        className="h-8 min-w-14 rounded-md px-1 font-mono text-xs text-fg-muted tabular-nums hover:bg-surface-3 hover:text-fg"
        onClick={() => zoomBy(1 / zoom)}
        aria-label={`Zoom ${Math.round(zoom * 100)}%. Reset to 100%`}
        title="Reset zoom to 100%"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        className={hudButton}
        onClick={() => zoomBy(1.25)}
        aria-label="Zoom in"
        title="Zoom in (mouse wheel)"
      >
        <Plus aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        className={hudButton}
        onClick={fit}
        aria-label="Fit everything in view"
        title="Fit everything in view"
      >
        <Maximize aria-hidden className="size-4" />
      </button>
    </div>
  )
}

function CalibrationBanner() {
  const cells = useUiStore((s) => s.calibrationCells)
  return (
    <div
      role="region"
      aria-label="Grid calibration"
      className="pointer-events-auto absolute top-3 left-1/2 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 space-y-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-lg"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label className="flex items-center gap-1.5">
          <span>Drag a box over</span>
          <input
            type="number"
            min={1}
            max={50}
            step={1}
            value={cells}
            aria-label="Cells per side"
            onChange={(event) => {
              const value = Math.round(Number(event.target.value))
              if (Number.isFinite(value)) {
                useUiStore.setState({ calibrationCells: Math.min(50, Math.max(1, value)) })
              }
            }}
            className="w-14 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-center"
          />
          <span>
            × {cells} {cells === 1 ? 'cell' : 'cells'} of the map&apos;s own grid
          </span>
        </label>
        <button
          type="button"
          onClick={() => setTool('select')}
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-0.5 text-fg-muted hover:bg-surface-3 hover:text-fg"
        >
          <X aria-hidden className="size-4" />
          Cancel (Esc)
        </button>
      </div>
      <p className="text-xs text-fg-muted">A box over more cells gives a more accurate grid.</p>
    </div>
  )
}

const segment =
  'rounded-md px-2 py-0.5 text-sm text-fg-muted aria-checked:bg-surface-3 aria-checked:text-fg hover:text-fg'

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg bg-surface-2 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={segment}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

const FOG_HINTS: Record<FogBrushShape, string> = {
  rect: 'Drag a rectangle (it snaps to the grid; hold Alt for free corners).',
  polygon:
    'Click the corners; click the first one, double-click or press Enter to close. Backspace removes a corner.',
  brush: 'Drag to paint.',
}

/** Options of the Fog tool (SPEC §5.6 manual brushes): mode, shape, brush size. */
function FogToolbar() {
  const mode = useUiStore((s) => s.fogMode)
  const shape = useUiStore((s) => s.fogShape)
  const brushCells = useUiStore((s) => s.fogBrushCells)
  const fogOn = useActiveScene().fog.enabled
  return (
    <div
      role="region"
      aria-label="Fog tool"
      className="pointer-events-auto absolute top-3 left-1/2 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 space-y-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-lg"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Fog edit"
          value={mode}
          options={[
            { value: 'reveal', label: 'Reveal' },
            { value: 'hide', label: 'Hide' },
          ]}
          onChange={(fogMode) => useUiStore.setState({ fogMode })}
        />
        <Segmented
          label="Shape"
          value={shape}
          options={[
            { value: 'rect', label: 'Rectangle' },
            { value: 'polygon', label: 'Polygon' },
            { value: 'brush', label: 'Brush' },
          ]}
          onChange={(fogShape) => useUiStore.setState({ fogShape, fogDraft: null })}
        />
        {shape === 'brush' && (
          <div className="flex items-center gap-1.5">
            <span className="text-fg-muted">Size</span>
            <div className="w-16">
              {/* Commits on Enter or blur, so the field can be cleared and retyped. */}
              <CommitNumberInput
                aria-label="Brush size in squares"
                min={0.5}
                max={20}
                step={0.5}
                value={brushCells}
                onCommit={(fogBrushCells) => useUiStore.setState({ fogBrushCells })}
              />
            </div>
            <span className="text-fg-muted">squares</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setTool('select')}
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-0.5 text-fg-muted hover:bg-surface-3 hover:text-fg"
        >
          <X aria-hidden className="size-4" />
          Done (Esc)
        </button>
      </div>
      <p className="text-xs text-fg-muted">{FOG_HINTS[shape]}</p>
      {!fogOn && (
        <p className="flex flex-wrap items-center gap-2 text-xs">
          <span>Fog is off for this scene, so players see everything.</span>
          <button
            type="button"
            onClick={() => setSceneFog({ enabled: true })}
            className="rounded-md border border-border bg-surface-2 px-2 py-0.5 hover:bg-surface-3"
          >
            Turn on fog
          </button>
        </p>
      )}
    </div>
  )
}

function EmptyState() {
  const fileInput = useRef<HTMLInputElement>(null)
  const importing = useUiStore((s) => s.importProgress !== null)
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <section
        aria-labelledby="empty-state-heading"
        className="pointer-events-auto max-w-xl space-y-4 rounded-xl border border-border bg-surface/95 p-5 text-center shadow-xl"
      >
        <div className="space-y-1">
          <h2 id="empty-state-heading" className="text-lg font-medium">
            Drop a map image here or pick a default map
          </h2>
          <p className="text-sm text-fg-muted">
            Your own maps can be PNG, JPEG or WebP; they are saved in this browser. Then drag tokens
            and props from the library on the right.
          </p>
        </div>
        <button
          type="button"
          className={buttonClass}
          disabled={importing}
          onClick={() => fileInput.current?.click()}
        >
          <Upload aria-hidden className="size-4" />
          Upload a map…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_MIMES.join(',')}
          hidden
          aria-label="Upload a map"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])]
            event.target.value = ''
            void importAndPlace(files, 'map', null)
          }}
        />
        <ul className="grid grid-cols-3 gap-3">
          {MAP_ASSETS.map((asset) => (
            <li key={asset.id}>
              <button
                type="button"
                onClick={() => placeLibraryEntry({ type: 'asset', assetId: asset.id }, null)}
                className="group w-full space-y-1.5 rounded-lg border border-border bg-surface-2 p-2 hover:border-accent"
              >
                <img
                  src={builtinThumbnailUrl(asset)}
                  alt=""
                  className="aspect-[4/3] w-full rounded object-cover"
                />
                <span className="block text-sm group-hover:text-accent">{asset.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Notice() {
  const notice = useUiStore((s) => s.notice)
  const progress = useUiStore((s) => s.importProgress)
  useEffect(() => {
    if (!notice || notice.sticky) return
    const timer = setTimeout(() => {
      if (useUiStore.getState().notice?.id === notice.id) useUiStore.setState({ notice: null })
    }, 3500)
    return () => clearTimeout(timer)
  }, [notice])
  const box =
    'pointer-events-auto max-w-[min(36rem,calc(100vw-4rem))] rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-lg'
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute bottom-16 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {progress && (
        <p className={`${box} flex items-center gap-2`}>
          <LoaderCircle aria-hidden className="size-4 animate-spin text-fg-muted" />
          Importing image {Math.min(progress.done + 1, progress.total)} of {progress.total}…
        </p>
      )}
      {notice && (
        <div className={`${box} flex items-start gap-2`}>
          <div className="space-y-1">
            {notice.lines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
          {notice.sticky && (
            <button
              type="button"
              onClick={() => useUiStore.setState({ notice: null })}
              aria-label="Dismiss message"
              title="Dismiss"
              className="-my-0.5 -mr-1 shrink-0 rounded-md p-1 text-fg-muted hover:bg-surface-3 hover:text-fg"
            >
              <X aria-hidden className="size-4" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function PreviewBanner() {
  return (
    <div
      role="region"
      aria-label="Preview as players"
      className="pointer-events-auto absolute top-3 left-1/2 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-3 rounded-lg border border-accent bg-surface px-3 py-2 text-sm shadow-lg"
    >
      <ScanEye aria-hidden className="size-4 text-accent" />
      <span>Previewing what players see. Editing is paused.</span>
      <button
        type="button"
        onClick={() => useUiStore.setState({ previewAsPlayers: false })}
        className="flex items-center gap-1 rounded-md px-2 py-0.5 text-fg-muted hover:bg-surface-3 hover:text-fg"
      >
        <X aria-hidden className="size-4" />
        Stop preview (Esc)
      </button>
    </div>
  )
}

/** HTML controls drawn over the canvas. */
export function CanvasHud() {
  const tool = useUiStore((s) => s.tool)
  const preview = useUiStore((s) => s.previewAsPlayers)
  const scene = useActiveScene()
  const empty =
    scene.layers.map.length + scene.layers.props.length + scene.layers.tokens.length === 0
  return (
    <div className="pointer-events-none absolute inset-0">
      {preview ? (
        <>
          <PreviewInitiative />
          <PreviewBanner />
        </>
      ) : (
        <>
          {empty && tool === 'select' && <EmptyState />}
          {tool === 'calibrate' && <CalibrationBanner />}
          {tool === 'fog' && <FogToolbar />}
        </>
      )}
      <ZoomControls />
      <Notice />
    </div>
  )
}
