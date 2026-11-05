import { memo } from 'react'
import { Circle, Group, Image, Path, Rect, Text } from 'react-konva'
import { GLYPHS } from '../assets/builtin/glyphs'
import { isBuiltinId, tokenLook } from '../assets/builtin/registry'
import type { AssetImage } from '../assets/images'
import { readableOn } from './color'
import { useAssetImage } from './useAssetImage'

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

/** Radius of an uploaded token image, as a fraction of the token radius; the ring shows outside it. */
const IMAGE_RADIUS = 0.88

/** Size and position that make an image cover a centered circle of radius `radius`. */
function cover(image: AssetImage, radius: number) {
  const width = image instanceof HTMLImageElement ? image.naturalWidth : image.width
  const height = image instanceof HTMLImageElement ? image.naturalHeight : image.height
  const scale = (2 * radius) / Math.max(1, Math.min(width, height))
  return {
    x: (-width * scale) / 2,
    y: (-height * scale) / 2,
    width: width * scale,
    height: height * scale,
  }
}

/**
 * A token: a disc in the token's ring color with its badge (initials tokens), a
 * glyph, or an uploaded image cropped to a circle. Glyph and image tokens show
 * the badge as a number pip. Unknown built-in assets draw the disc with the
 * badge; an uploaded image that is missing or still loading draws the bare disc.
 * Props only.
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
  const upload = !isBuiltinId(assetId)
  const image = useAssetImage(upload ? assetId : null)
  const foreground = readableOn(color)
  const glyph = look?.type === 'glyph' ? GLYPHS[look.glyph] : null
  const glyphScale = (r * 1.2) / 24
  const pip = glyph !== null || upload
  const text = pip ? null : (badge ?? '')
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
      {upload ? (
        image && (
          <Group
            clipFunc={(context) => context.arc(0, 0, r * IMAGE_RADIUS, 0, Math.PI * 2, false)}
            listening={false}
          >
            <Image image={image} {...cover(image, r * IMAGE_RADIUS)} perfectDrawEnabled={false} />
          </Group>
        )
      ) : (
        <Circle
          radius={r * 0.84}
          stroke={foreground}
          strokeWidth={r * 0.035}
          opacity={0.35}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
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
      {pip && badge && (
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
