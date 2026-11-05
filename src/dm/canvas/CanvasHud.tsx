import { Maximize, Minus, Plus, X } from 'lucide-react'
import { useEffect } from 'react'
import { builtinThumbnailUrl, MAP_ASSETS } from '../../assets/builtin/registry'
import { clampZoom, fitRect, zoomAt } from '../../geometry/camera'
import { contentBounds } from '../../store/actions'
import { useActiveScene } from '../../store/campaign'
import { setTool, useUiStore } from '../../store/ui'
import { placeLibraryEntry } from '../placement'

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

function EmptyState() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <section
        aria-labelledby="empty-state-heading"
        className="pointer-events-auto max-w-xl space-y-4 rounded-xl border border-border bg-surface/95 p-5 text-center shadow-xl"
      >
        <div className="space-y-1">
          <h2 id="empty-state-heading" className="text-lg font-medium">
            Pick a default map to start
          </h2>
          <p className="text-sm text-fg-muted">
            Then drag tokens and props from the library on the right. Uploading your own maps
            arrives in milestone 3.
          </p>
        </div>
        <ul className="grid grid-cols-3 gap-3">
          {MAP_ASSETS.map((asset) => (
            <li key={asset.id}>
              <button
                type="button"
                onClick={() => placeLibraryEntry({ type: 'image', assetId: asset.id }, null)}
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
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => {
      if (useUiStore.getState().notice?.id === notice.id) useUiStore.setState({ notice: null })
    }, 3500)
    return () => clearTimeout(timer)
  }, [notice])
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2"
    >
      {notice && (
        <p className="rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-lg">
          {notice.text}
        </p>
      )}
    </div>
  )
}

/** HTML controls drawn over the canvas. */
export function CanvasHud() {
  const tool = useUiStore((s) => s.tool)
  const scene = useActiveScene()
  const empty =
    scene.layers.map.length + scene.layers.props.length + scene.layers.tokens.length === 0
  return (
    <div className="pointer-events-none absolute inset-0">
      {empty && tool === 'select' && <EmptyState />}
      {tool === 'calibrate' && <CalibrationBanner />}
      <ZoomControls />
      <Notice />
    </div>
  )
}
