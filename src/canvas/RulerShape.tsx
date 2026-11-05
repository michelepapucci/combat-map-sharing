import { Circle, Group, Label, Line, Tag, Text } from 'react-konva'
import type { Point } from '../geometry/types'

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
export const RULER_COLOR = '#ffd166'

/**
 * A measured path (SPEC §5.4): a dashed line with a dark halo, dots on the
 * waypoints, and the total length at the end. Sizes are in screen px (divided
 * by the stage `scale`). Shared by the DM and player canvases; props only.
 */
export function RulerShape({
  points,
  label,
  scale,
}: {
  points: readonly Point[]
  label: string
  scale: number
}) {
  const end = points.at(-1)
  if (points.length < 2 || !end) return null
  const flat = points.flatMap((p) => [p.x, p.y])
  return (
    <Group name="ruler" listening={false}>
      <Line
        points={flat}
        stroke="rgba(0, 0, 0, 0.55)"
        strokeWidth={6 / scale}
        lineCap="round"
        lineJoin="round"
        perfectDrawEnabled={false}
      />
      <Line
        points={flat}
        stroke={RULER_COLOR}
        strokeWidth={3 / scale}
        dash={[10 / scale, 6 / scale]}
        lineCap="round"
        lineJoin="round"
        perfectDrawEnabled={false}
      />
      {points.map((p, i) => (
        <Circle
          key={i}
          x={p.x}
          y={p.y}
          radius={(i === 0 || i === points.length - 1 ? 5 : 4) / scale}
          fill={RULER_COLOR}
          stroke="#000000"
          strokeWidth={1.5 / scale}
          perfectDrawEnabled={false}
        />
      ))}
      <Label x={end.x} y={end.y - 10 / scale} scaleX={1 / scale} scaleY={1 / scale}>
        <Tag
          fill="rgba(12, 14, 18, 0.88)"
          cornerRadius={4}
          pointerDirection="down"
          pointerWidth={10}
          pointerHeight={6}
        />
        <Text
          text={label}
          fontFamily={FONT}
          fontSize={15}
          fontStyle="bold"
          fill="#ffffff"
          padding={6}
        />
      </Label>
    </Group>
  )
}
