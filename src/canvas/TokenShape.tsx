import { memo } from 'react'
import { Circle, Group, Image, Path, Rect, Text } from 'react-konva'
import { GLYPHS } from '../assets/builtin/glyphs'
import { isBuiltinId, tokenLook } from '../assets/builtin/registry'
import type { AssetImage } from '../assets/images'
import { hpColor, readableOn } from './color'
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
  /** Text under the token (only when players may see it). */
  label?: string | null
  /** Hit points as a fraction 0..1, or null for no bar. */
  hpFraction?: number | null
  /** DM window: a bar players do not see is drawn fainter. */
  hpPrivate?: boolean
  conditions?: readonly string[]
}

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
const OUTLINE = '#0b0d12'

/** Two-letter marks for the standard 5e conditions; custom ones use their first two letters. */
const CONDITION_MARKS: Readonly<Record<string, string>> = {
  blinded: 'Bl',
  charmed: 'Ch',
  deafened: 'De',
  exhaustion: 'Ex',
  frightened: 'Fr',
  grappled: 'Gr',
  incapacitated: 'In',
  invisible: 'Iv',
  paralyzed: 'Pa',
  petrified: 'Pe',
  poisoned: 'Po',
  prone: 'Pr',
  restrained: 'Re',
  stunned: 'St',
  unconscious: 'Un',
}

function conditionMark(condition: string): string {
  const known = CONDITION_MARKS[condition.trim().toLowerCase()]
  if (known) return known
  const letters = Array.from(condition.trim())
  return (letters[0] ?? '?').toUpperCase() + (letters[1] ?? '').toLowerCase()
}

const MAX_CONDITION_MARKS = 4

/**
 * What players read around a token: conditions above it, the HP bar and the
 * label below. Not rotated with the token and not part of its bounds (so the
 * Transformer still rotates the token about its center).
 */
function TokenDecorations({
  x,
  y,
  r,
  opacity,
  label,
  hpFraction,
  hpPrivate,
  conditions,
}: {
  x: number
  y: number
  r: number
  opacity: number
  label: string | null
  hpFraction: number | null
  hpPrivate: boolean
  conditions: readonly string[]
}) {
  // Sized for a TV across the room: a medium token's label is 0.3 of a square.
  const barHeight = Math.max(r * 0.18, 3)
  const barY = r + r * 0.08
  const labelSize = Math.min(36, Math.max(12, r * 0.6))
  const labelY = hpFraction === null ? r + r * 0.06 : barY + barHeight + r * 0.06
  const markRadius = r * 0.34
  const shown = conditions.slice(0, MAX_CONDITION_MARKS)
  const extra = conditions.length - shown.length
  const marks = extra > 0 ? [...shown.map(conditionMark), `+${extra}`] : shown.map(conditionMark)
  const rowWidth = (marks.length - 1) * markRadius * 2.3
  return (
    <Group x={x} y={y} opacity={opacity} listening={false}>
      {marks.map((mark, i) => (
        <Group
          key={`${mark}-${i}`}
          x={-rowWidth / 2 + i * markRadius * 2.3}
          y={-r - markRadius * 0.4}
        >
          <Circle
            radius={markRadius}
            fill="#4c3a8c"
            stroke={OUTLINE}
            strokeWidth={markRadius * 0.15}
            perfectDrawEnabled={false}
          />
          <Text
            text={mark}
            x={-markRadius}
            y={-markRadius}
            width={markRadius * 2}
            height={markRadius * 2}
            align="center"
            verticalAlign="middle"
            fontFamily={FONT}
            fontStyle="bold"
            fontSize={markRadius * 0.95}
            fill="#ffffff"
            perfectDrawEnabled={false}
          />
        </Group>
      ))}
      {hpFraction !== null && (
        <Group y={barY} opacity={hpPrivate ? 0.55 : 1}>
          <Rect
            x={-r * 0.75}
            width={r * 1.5}
            height={barHeight}
            fill={OUTLINE}
            cornerRadius={barHeight / 2}
            perfectDrawEnabled={false}
          />
          <Rect
            x={-r * 0.75}
            width={r * 1.5 * Math.min(1, Math.max(0, hpFraction))}
            height={barHeight}
            fill={hpColor(hpFraction)}
            cornerRadius={barHeight / 2}
            perfectDrawEnabled={false}
          />
        </Group>
      )}
      {label && (
        <Text
          text={label}
          x={-r * 2.5}
          y={labelY}
          width={r * 5}
          align="center"
          wrap="none"
          ellipsis
          fontFamily={FONT}
          fontStyle="bold"
          fontSize={labelSize}
          fill="#ffffff"
          stroke={OUTLINE}
          strokeWidth={labelSize * 0.22}
          fillAfterStrokeEnabled
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  )
}

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
  label = null,
  hpFraction = null,
  hpPrivate = false,
  conditions = [],
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

  const decorated = label !== null || hpFraction !== null || conditions.length > 0
  return (
    <>
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
      {decorated && (
        <TokenDecorations
          x={x}
          y={y}
          r={r}
          opacity={opacity}
          label={label}
          hpFraction={hpFraction}
          hpPrivate={hpPrivate}
          conditions={conditions}
        />
      )}
    </>
  )
})
