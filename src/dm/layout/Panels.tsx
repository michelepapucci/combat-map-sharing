import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { PanelFrame } from './PanelFrame'
import { beginPanelResize } from './panelDrag'
import {
  bringToFront,
  clampAllToViewport,
  PANEL_IDS,
  usePanelLayout,
  type PanelId,
} from './panelLayout'

/** Ids of the docked panels (or floating ones), as a string so the selector is stable. */
function useIds(floating: boolean): PanelId[] {
  const key = usePanelLayout((s) =>
    PANEL_IDS.filter((id) => s.panels[id].floating === floating).join(','),
  )
  return key === '' ? [] : (key.split(',') as PanelId[])
}

/** The right sidebar: the docked panels, each a separate card. */
export function Sidebar() {
  const ids = useIds(false)
  if (ids.length === 0) return null
  return (
    <aside
      aria-label="Panels"
      className="flex min-h-0 flex-col gap-2 overflow-y-auto border-l border-border bg-bg p-2"
    >
      {ids.map((id) => (
        <PanelFrame key={id} id={id} />
      ))}
    </aside>
  )
}

function FloatingPanel({ id }: { id: PanelId }) {
  const { x, y, width, height, collapsed, z } = usePanelLayout((s) => s.panels[id])
  const ref = useRef<HTMLDivElement>(null)
  const onResizeDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return
    const frame = ref.current?.getBoundingClientRect()
    if (!frame) return
    event.preventDefault()
    beginPanelResize(id, event, frame)
  }
  return (
    // Any press brings the panel to the front.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- stacking only
    <div
      ref={ref}
      onPointerDownCapture={() => bringToFront(id)}
      className="fixed flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl ring-1 ring-black/20"
      style={{
        left: x,
        top: y,
        width,
        height: collapsed || height === null ? undefined : height,
        maxHeight: `calc(100vh - ${y}px - 8px)`,
        zIndex: 20 + z,
      }}
    >
      <PanelFrame id={id} />
      {!collapsed && (
        <div
          aria-hidden
          onPointerDown={onResizeDown}
          title="Drag to resize"
          className="absolute right-0 bottom-0 size-4 cursor-nwse-resize"
          style={{
            background:
              'linear-gradient(135deg, transparent 50%, var(--border) 50%, var(--border) 60%, transparent 60%, transparent 72%, var(--border) 72%, var(--border) 82%, transparent 82%)',
          }}
        />
      )}
    </div>
  )
}

/** Panels popped out of the sidebar, floating over the map where the DM put them. */
export function FloatingPanels() {
  const ids = useIds(true)
  // A smaller window must not strand a panel off screen.
  useEffect(() => {
    clampAllToViewport()
    window.addEventListener('resize', clampAllToViewport)
    return () => window.removeEventListener('resize', clampAllToViewport)
  }, [])
  return (
    <>
      {ids.map((id) => (
        <FloatingPanel key={id} id={id} />
      ))}
    </>
  )
}
