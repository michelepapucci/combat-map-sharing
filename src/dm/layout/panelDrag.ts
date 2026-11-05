import { movePanel, popOut, resizePanel, usePanelLayout, type PanelId } from './panelLayout'

/**
 * Pointer drags of the panels' headers and resize grips. They run on window
 * listeners, not on the element that started them, because a docked panel
 * dragged out remounts as a floating one in the middle of the drag.
 */

/** A press must move this far (px) before a docked panel pops out. */
const POP_OUT_DISTANCE = 6

function track(onMove: (event: PointerEvent) => void, cursor: string): void {
  const body = document.body.style
  const previous = { userSelect: body.userSelect, cursor: body.cursor }
  body.userSelect = 'none'
  body.cursor = cursor
  const end = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    body.userSelect = previous.userSelect
    body.cursor = previous.cursor
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}

/**
 * Moves a panel by its header. A docked panel pops out once the pointer has
 * moved a little, under the pointer where it was grabbed.
 */
export function beginPanelMove(
  id: PanelId,
  event: { clientX: number; clientY: number },
  frame: DOMRect,
): void {
  const start = { x: event.clientX, y: event.clientY }
  const grab = { x: event.clientX - frame.left, y: event.clientY - frame.top }
  let floating = usePanelLayout.getState().panels[id].floating
  track((move) => {
    if (!floating) {
      if (Math.hypot(move.clientX - start.x, move.clientY - start.y) < POP_OUT_DISTANCE) return
      const { width } = usePanelLayout.getState().panels[id]
      grab.x = Math.min(grab.x, width - 24)
      popOut(id, { x: move.clientX - grab.x, y: move.clientY - grab.y, width })
      floating = true
    }
    movePanel(id, move.clientX - grab.x, move.clientY - grab.y)
  }, 'grabbing')
}

/** Resizes a floating panel from its bottom-right grip. */
export function beginPanelResize(
  id: PanelId,
  event: { clientX: number; clientY: number },
  frame: DOMRect,
): void {
  const start = { x: event.clientX, y: event.clientY, width: frame.width, height: frame.height }
  track((move) => {
    resizePanel(id, start.width + move.clientX - start.x, start.height + move.clientY - start.y)
  }, 'nwse-resize')
}
