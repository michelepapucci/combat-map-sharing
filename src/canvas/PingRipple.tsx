import { useEffect, useState } from 'react'
import { Circle, Group } from 'react-konva'

/** How long a ping ripple lasts, in both windows (ms). */
export const PING_MS = 1600

const RINGS = 3

/**
 * An animated ripple at a world point (SPEC §5.9 "Ping"). Sizes are in screen
 * px, divided by the stage `scale`, so a ping looks the same at any zoom.
 * Shared by the DM and player canvases; props only.
 */
export function PingRipple({
  x,
  y,
  startedAt,
  scale,
  color = '#ffd166',
}: {
  x: number
  y: number
  /** performance.now() when the ping started (in this window). */
  startedAt: number
  scale: number
  color?: string
}) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    let frame = requestAnimationFrame(function tick(time) {
      setNow(time)
      if (time - startedAt < PING_MS) frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [startedAt])
  const t = Math.min(1, Math.max(0, (now - startedAt) / PING_MS))
  return (
    <Group name="ping" x={x} y={y} listening={false}>
      {Array.from({ length: RINGS }, (_, ring) => {
        const local = Math.min(1, Math.max(0, t * 1.6 - ring * 0.3))
        return (
          <Circle
            key={ring}
            radius={(8 + local * 64) / scale}
            stroke={color}
            strokeWidth={4 / scale}
            opacity={local === 0 ? 0 : 1 - local}
            perfectDrawEnabled={false}
          />
        )
      })}
      <Circle radius={7 / scale} fill={color} opacity={1 - t} perfectDrawEnabled={false} />
    </Group>
  )
}
