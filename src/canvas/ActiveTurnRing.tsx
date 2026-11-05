import Konva from 'konva'
import { useEffect, useRef } from 'react'
import { Circle, Group } from 'react-konva'

/** The color of the current turn, in both windows (ring and tracker highlight). */
export const ACTIVE_TURN_COLOR = '#ffd166'

const PERIOD_MS = 1400
/** About 30 redraws a second: smooth enough for a pulse, half the cost of every frame. */
const FRAME_MS = 33

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * The pulsing ring around the token whose turn it is (SPEC §5.8): a steady ring
 * just outside the token plus one that grows and fades. The pulse redraws the
 * layer it is on, about 30 times a second: give it a small layer of its own (the
 * player window does). With reduced motion only the steady ring is drawn.
 * Shared by the DM and player canvases; props only.
 */
export function ActiveTurnRing({ x, y, radius }: { x: number; y: number; radius: number }) {
  const pulse = useRef<Konva.Circle>(null)
  useEffect(() => {
    const node = pulse.current
    const layer = node?.getLayer()
    if (!node || !layer || prefersReducedMotion()) return
    const clock = { last: -Infinity }
    const animation = new Konva.Animation((frame) => {
      const time = frame?.time ?? 0
      // Returning false skips the layer redraw for this frame.
      if (time - clock.last < FRAME_MS) return false
      clock.last = time
      const t = (time % PERIOD_MS) / PERIOD_MS
      node.scale({ x: 1 + 0.3 * t, y: 1 + 0.3 * t })
      node.opacity(0.85 * (1 - t))
      return true
    }, layer)
    animation.start()
    return () => {
      animation.stop()
    }
  }, [])
  const ring = radius * 1.14
  return (
    <Group name="active-turn" x={x} y={y} listening={false}>
      <Circle
        radius={ring}
        stroke={ACTIVE_TURN_COLOR}
        strokeWidth={Math.max(radius * 0.1, 1.5)}
        perfectDrawEnabled={false}
      />
      <Circle
        ref={pulse}
        radius={ring}
        stroke={ACTIVE_TURN_COLOR}
        strokeWidth={Math.max(radius * 0.08, 1)}
        opacity={0}
        perfectDrawEnabled={false}
      />
    </Group>
  )
}
