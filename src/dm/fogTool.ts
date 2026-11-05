import type { Point } from '../geometry/types'
import { addFogEdit, flatPoints } from '../store/fogActions'
import { useUiStore } from '../store/ui'

/**
 * The Fog tool's polygon (click corners; close with a click on the first one,
 * a double-click on the last one or Enter; Backspace removes the last corner; Esc cancels).
 * Rectangles and brush strokes are drags, handled in DmCanvas.
 */

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Drops corners closer than `minGap` world px to the previous one (double-clicks add two). */
function distinct(points: readonly Point[], minGap: number): Point[] {
  const result: Point[] = []
  for (const point of points) {
    const last = result.at(-1)
    if (!last || distance(last, point) >= minGap) result.push(point)
  }
  return result
}

/**
 * Commits the polygon being drawn. With fewer than three distinct corners the
 * draft stays, so a stray Enter or double-click never throws corners away.
 */
export function closeFogPolygon(): boolean {
  const { fogDraft, fogMode, dmCamera } = useUiStore.getState()
  if (fogDraft?.type !== 'polygon') return false
  const points = distinct(fogDraft.points, 3 / dmCamera.zoom)
  if (points.length < 3) return false
  useUiStore.setState({ fogDraft: null })
  return addFogEdit(fogMode, { type: 'polygon', points: flatPoints(points) })
}

export function removeLastFogCorner(): boolean {
  const { fogDraft } = useUiStore.getState()
  if (fogDraft?.type !== 'polygon') return false
  const points = fogDraft.points.slice(0, -1)
  useUiStore.setState({ fogDraft: points.length > 0 ? { ...fogDraft, points } : null })
  return true
}
