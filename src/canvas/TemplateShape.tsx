import { Circle, Group, Line } from 'react-konva'
import {
  templateCircle,
  templatePolygon,
  type AoeGrid,
  type TemplateGeometry,
} from '../geometry/aoe'

/**
 * An area-of-effect template (SPEC §5.5): a translucent fill in its color with
 * a solid outline (dashed when `dashed`, for templates hidden from players) and
 * a dot at its origin. Strokes are in screen px (divided by the stage `scale`).
 * Shared by the DM and player canvases; props only.
 */
export function TemplateShape({
  template,
  grid,
  scale,
  dashed = false,
  emphasis = false,
}: {
  template: TemplateGeometry & { color: string }
  grid: AoeGrid
  scale: number
  dashed?: boolean
  /** Stronger fill and outline: the template being placed or selected. */
  emphasis?: boolean
}) {
  const circle = templateCircle(template, grid)
  const polygon = circle ? null : templatePolygon(template, grid)
  if (!circle && !polygon) return null
  const style = {
    stroke: template.color,
    strokeWidth: (emphasis ? 3 : 2) / scale,
    dash: dashed ? [8 / scale, 6 / scale] : undefined,
    perfectDrawEnabled: false,
  }
  const fillOpacity = emphasis ? 0.28 : 0.2
  return (
    <Group name="template-shape" listening={false}>
      {circle ? (
        <>
          <Circle
            x={circle.x}
            y={circle.y}
            radius={circle.r}
            fill={template.color}
            opacity={fillOpacity}
            perfectDrawEnabled={false}
          />
          <Circle x={circle.x} y={circle.y} radius={circle.r} {...style} fillEnabled={false} />
        </>
      ) : (
        <>
          <Line
            points={polygon ?? []}
            closed
            fill={template.color}
            opacity={fillOpacity}
            perfectDrawEnabled={false}
          />
          <Line points={polygon ?? []} closed {...style} fillEnabled={false} lineJoin="round" />
        </>
      )}
      <Circle
        x={template.originX}
        y={template.originY}
        radius={4 / scale}
        fill={template.color}
        stroke="#000000"
        strokeWidth={1 / scale}
        perfectDrawEnabled={false}
      />
    </Group>
  )
}
