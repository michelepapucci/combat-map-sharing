import Konva from 'konva'
import { useEffect, useState } from 'react'

/**
 * The window's device pixel ratio, kept current when the window moves to a
 * screen with another density (the player popup is often opened on a laptop and
 * dragged to the TV). Konva reads its pixel ratio when it creates canvases, so
 * callers remount their Stage with `key={dpr}` to redraw sharply.
 */
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1)
  useEffect(() => {
    const query = window.matchMedia(`(resolution: ${dpr}dppx)`)
    const onChange = () => {
      const next = window.devicePixelRatio || 1
      Konva.pixelRatio = next
      setDpr(next)
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [dpr])
  return dpr
}
