import { memo } from 'react'
import { Circle, Group, Path, Rect, Text } from 'react-konva'
import { GLYPHS } from '../assets/builtin/glyphs'
import { tokenLook } from '../assets/builtin/registry'
import { readableOn } from './color'

export interface TokenShapeProps {
  /** Konva node id: the token id. Omit for decorative copies (drag ghosts). */
  id?: string
  assetId: string
  x: number
  y: number
  /** Footprint edge in world px. */
  size: number
  rotation: number
  opacity: number
  /** Ring color. */
  color: string
  badge: string | null
  listening?: boolean
}

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
const OUTLINE = '#0b0d12'

/**
 * A token: a disc in the token's color with its badge (initials tokens) or a
 * glyph plus an optional number pip. Uploaded token images arrive in milestone 3;
 * until then an unknown asset draws the disc with its badge. Props only.
 */
export const TokenShape = memo(function TokenShape({
  id,
  assetId,
  x,
  y,
  size,
  rotation,
  opacity,
  color,
  badge,
  listening = true,
}: TokenShapeProps) {
  const r = size / 2
  const look = tokenLook(assetId)
  const foreground = readableOn(color)
  const glyph = look?.type === 'glyph' ? GLYPHS[look.glyph] : null
  const glyphScale = (r * 1.2) / 24
  const text = glyph ? null : (badge ?? '')
  const textSize = r * ([1.05, 1.05, 0.85, 0.66][Array.from(text ?? '').length] ?? 0.66)

  return (
    <Group
      id={id}
      name={id ? 'item' : undefined}
      x={x}
      y={y}
      rotation={rotation}
      opacity={opacity}
      listening={listening}
    >
      {/* Bounds = the footprint exactly, so the Transformer rotates about the center. */}
      <Rect x={-r} y={-r} width={2 * r} height={2 * r} listening={false} />
      <Circle radius={r * 0.97} fill={color} stroke={OUTLINE} strokeWidth={r * 0.06} />
      <Circle
        radius={r * 0.84}
        stroke={foreground}
        strokeWidth={r * 0.035}
        opacity={0.35}
        listening={false}
        perfectDrawEnabled={false}
      />
      {glyph && (
        <Group
          x={-12 * glyphScale}
          y={-12 * glyphScale}
          scaleX={glyphScale}
          scaleY={glyphScale}
          listening={false}
        >
          {glyph.map((part, i) => (
            <Path
              key={i}
              data={part.d}
              fill={foreground}
              fillRule={part.evenodd ? 'evenodd' : 'nonzero'}
              perfectDrawEnabled={false}
            />
          ))}
        </Group>
      )}
      {text !== null && (
        <Text
          text={text}
          x={-r}
          y={-r}
          width={2 * r}
          height={2 * r}
          align="center"
          verticalAlign="middle"
          fontFamily={FONT}
          fontStyle="bold"
          fontSize={textSize}
          fill={foreground}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
      {glyph && badge && (
        <Group x={r * 0.63} y={r * 0.63} listening={false}>
          <Circle radius={r * 0.36} fill={OUTLINE} stroke={color} strokeWidth={r * 0.06} />
          <Text
            text={badge}
            x={-r * 0.36}
            y={-r * 0.36}
            width={r * 0.72}
            height={r * 0.72}
            align="center"
            verticalAlign="middle"
            fontFamily={FONT}
            fontStyle="bold"
            fontSize={r * (badge.length > 1 ? 0.3 : 0.42)}
            fill="#ffffff"
          />
        </Group>
      )}
    </Group>
  )
})
