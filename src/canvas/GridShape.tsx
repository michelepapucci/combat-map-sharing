import { memo } from 'react'
import { Shape } from 'react-konva'
import { linesInRange } from '../geometry/grid'

export interface GridShapeProps {
  size: number
  offsetX: number
  offsetY: number
  color: string
  opacity: number
}

/** Below this many screen px per cell the grid is not drawn (it would be a solid wash). */
const MIN_SCREEN_CELL = 6

/**
 * The square grid as one shape that draws only the lines in view, with 1-screen-px
 * strokes at any zoom. It reads the stage transform at draw time, so panning and
 * zooming need no React render.
 */
export const GridShape = memo(function GridShape({
  size,
  offsetX,
  offsetY,
  color,
  opacity,
}: GridShapeProps) {
  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      stroke={color}
      strokeWidth={1}
      strokeScaleEnabled={false}
      opacity={opacity}
      sceneFunc={(context, shape) => {
        const stage = shape.getStage()
        if (!stage) return
        const scale = stage.scaleX()
        if (size * scale < MIN_SCREEN_CELL) return
        const minX = -stage.x() / scale
        const minY = -stage.y() / scale
        const maxX = minX + stage.width() / scale
        const maxY = minY + stage.height() / scale
        context.beginPath()
        for (const x of linesInRange(minX, maxX, offsetX, size)) {
          context.moveTo(x, minY)
          context.lineTo(x, maxY)
        }
        for (const y of linesInRange(minY, maxY, offsetY, size)) {
          context.moveTo(minX, y)
          context.lineTo(maxX, y)
        }
        context.strokeShape(shape)
      }}
    />
  )
})
