import { ChevronDown, GripHorizontal, PanelRightClose, PictureInPicture2 } from 'lucide-react'
import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { beginPanelMove } from './panelDrag'
import { dock, movePanel, popOut, setCollapsed, usePanelLayout, type PanelId } from './panelLayout'
import { PANELS } from './registry'

const headerButton =
  'flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg'

/** Presses on these start no drag: they are the header's own controls. */
function isControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, input, select, textarea, a') !== null
}

/**
 * One side panel as a card: a header (icon, title, extra status, collapse,
 * pop out / dock) and the panel's content. Docked in the sidebar or floating
 * over the map; dragging the header of a docked panel pops it out.
 */
export function PanelFrame({ id }: { id: PanelId }) {
  const { floating, collapsed } = usePanelLayout((s) => s.panels[id])
  const { title, icon: Icon, Body, Extra } = PANELS[id]
  const frameRef = useRef<HTMLElement>(null)
  const headingId = `panel-${id}-heading`
  const bodyId = `panel-${id}-body`

  const onHeaderPointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0 || isControl(event.target)) return
    const frame = frameRef.current?.getBoundingClientRect()
    if (!frame) return
    event.preventDefault()
    beginPanelMove(id, event, frame)
  }

  const popOutBeside = () => {
    const frame = frameRef.current?.getBoundingClientRect()
    const { width } = usePanelLayout.getState().panels[id]
    // Just left of where it was docked, over the map.
    popOut(id, {
      x: frame ? frame.left - width - 12 : 80,
      y: frame ? frame.top : 80,
      width,
    })
  }

  /** Keyboard moving of a floating panel: arrows move it (Shift for bigger steps). */
  const onMoveKey = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 64 : 16
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = delta[event.key]
    if (!move) return
    event.preventDefault()
    event.stopPropagation()
    const { x, y } = usePanelLayout.getState().panels[id]
    movePanel(id, x + move[0], y + move[1])
  }

  return (
    <section
      ref={frameRef}
      aria-labelledby={headingId}
      data-panel={id}
      className={
        floating
          ? 'flex min-h-0 flex-1 flex-col'
          : 'shrink-0 overflow-hidden rounded-lg border border-border bg-surface shadow-sm'
      }
    >
      {/* Dragging the header moves the panel (a docked one pops out); its buttons work as usual. */}
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- pointer drag only; the Move button does it from the keyboard */}
      <header
        onPointerDown={onHeaderPointerDown}
        className={`flex min-h-10 cursor-grab items-center gap-1.5 bg-surface-2/60 py-1 pr-1 pl-2.5 ${collapsed ? '' : 'border-b border-border'}`}
      >
        {floating && (
          <button
            type="button"
            aria-label={`Move the ${title} panel (arrow keys)`}
            title="Drag the header to move; arrow keys move it too"
            onKeyDown={onMoveKey}
            className={`${headerButton} -ml-1.5 cursor-grab`}
          >
            <GripHorizontal aria-hidden className="size-4" />
          </button>
        )}
        <Icon aria-hidden className="size-4 shrink-0 text-accent" />
        <h2
          id={headingId}
          className="shrink-0 text-xs font-semibold tracking-wider whitespace-nowrap text-fg uppercase select-none"
        >
          {title}
        </h2>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {Extra && (
            <div className="min-w-0 truncate whitespace-nowrap">
              <Extra />
            </div>
          )}
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
            title={collapsed ? 'Expand' : 'Collapse'}
            onClick={() => setCollapsed(id, !collapsed)}
            className={headerButton}
          >
            <ChevronDown
              aria-hidden
              className={`size-4 transition-transform ${collapsed ? '-rotate-90' : ''}`}
            />
          </button>
          <button
            type="button"
            aria-label={floating ? `Dock ${title} in the sidebar` : `Pop out ${title}`}
            title={floating ? 'Dock in the sidebar' : 'Pop out: move it anywhere over the map'}
            onClick={() => (floating ? dock(id) : popOutBeside())}
            className={headerButton}
          >
            {floating ? (
              <PanelRightClose aria-hidden className="size-4" />
            ) : (
              <PictureInPicture2 aria-hidden className="size-4" />
            )}
          </button>
        </div>
      </header>
      <div
        id={bodyId}
        hidden={collapsed}
        className={floating ? 'min-h-0 flex-1 overflow-y-auto p-3' : 'p-3'}
      >
        <Body />
      </div>
    </section>
  )
}
