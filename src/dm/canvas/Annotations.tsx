import { Circle, Group, Label, Line, Shape, Tag, Text } from 'react-konva'
import { RulerShape } from '../../canvas/RulerShape'
import { TemplateShape } from '../../canvas/TemplateShape'
import { templateCircle, templatePolygon, type AoeGrid } from '../../geometry/aoe'
import { rulerLabel, rulerLength } from '../../geometry/ruler'
import { formatLength } from '../../geometry/units'
import type { Rect } from '../../geometry/types'
import type { AoeCoverageRule, AoeTemplate, Scene, UnitSystem } from '../../state/types'
import { useActiveScene, useCampaign } from '../../store/campaign'
import { useUiStore } from '../../store/ui'
import { affectedBy } from './affected'

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"

/** A template where the DM sees it now: pinned ones follow a drag in progress. */
function livePlaced(
  template: AoeTemplate,
  liveDrag: Record<string, { x: number; y: number }> | null,
) {
  const live = liveDrag?.[template.id]
  return live ? { ...template, originX: live.x, originY: live.y } : template
}

/** What a template hits (SPEC §5.5): highlighted squares and ringed tokens. DM window only. */
function AffectedMarks({
  template,
  scene,
  rule,
  scale,
  cover,
  liveDrag,
}: {
  template: AoeTemplate
  scene: Scene
  rule: AoeCoverageRule
  scale: number
  /** The world area on screen: squares outside it are not drawn. */
  cover: Rect
  liveDrag: Record<string, { x: number; y: number }> | null
}) {
  const { grid } = scene
  // Tokens being dragged count where they are now.
  const tokens = scene.layers.tokens.map((token) => {
    const live = liveDrag?.[token.id]
    return live ? { ...token, x: live.x, y: live.y } : token
  })
  const { cells, tokenIds } = affectedBy(template, grid, rule, tokens)
  const hit = new Set(tokenIds)
  const i0 = Math.floor((cover.x - grid.offsetX) / grid.size) - 1
  const i1 = Math.ceil((cover.x + cover.width - grid.offsetX) / grid.size) + 1
  const j0 = Math.floor((cover.y - grid.offsetY) / grid.size) - 1
  const j1 = Math.ceil((cover.y + cover.height - grid.offsetY) / grid.size) + 1
  return (
    <>
      <Shape
        listening={false}
        perfectDrawEnabled={false}
        sceneFunc={(ctx) => {
          ctx.beginPath()
          for (const { i, j } of cells) {
            if (i < i0 || i > i1 || j < j0 || j > j1) continue
            ctx.rect(
              grid.offsetX + i * grid.size,
              grid.offsetY + j * grid.size,
              grid.size,
              grid.size,
            )
          }
          ctx.fillStyle = template.color
          ctx.globalAlpha = 0.22
          ctx.fill()
        }}
      />
      {tokens
        .filter((token) => hit.has(token.id))
        .map((token) => (
          <Circle
            key={token.id}
            x={token.x}
            y={token.y}
            radius={token.width / 2 + 5 / scale}
            stroke={template.color}
            strokeWidth={3 / scale}
            dash={[6 / scale, 4 / scale]}
            listening={false}
            perfectDrawEnabled={false}
          />
        ))}
    </>
  )
}

/** The far end of a template, where its size label goes. */
function farPoint(template: AoeTemplate, grid: AoeGrid): { x: number; y: number } {
  const circle = templateCircle(template, grid)
  const angle = (template.directionDeg * Math.PI) / 180
  if (circle)
    return { x: circle.x + Math.cos(angle) * circle.r, y: circle.y + Math.sin(angle) * circle.r }
  const polygon = templatePolygon(template, grid) ?? []
  // The polygon vertex farthest from the origin.
  let best = { x: template.originX, y: template.originY }
  let bestDistance = -1
  for (let k = 0; k + 1 < polygon.length; k += 2) {
    const x = polygon[k] ?? 0
    const y = polygon[k + 1] ?? 0
    const d = Math.hypot(x - template.originX, y - template.originY)
    if (d > bestDistance) {
      bestDistance = d
      best = { x, y }
    }
  }
  return best
}

function templateSizeText(template: AoeTemplate, units: UnitSystem): string {
  const size = formatLength(template.sizeFt, units)
  return template.shape === 'line' ? `${size} × ${formatLength(template.widthFt, units)}` : size
}

function SizeLabel({
  template,
  grid,
  units,
  scale,
}: {
  template: AoeTemplate
  grid: AoeGrid
  units: UnitSystem
  scale: number
}) {
  const at = farPoint(template, grid)
  return (
    <Label x={at.x} y={at.y - 8 / scale} scaleX={1 / scale} scaleY={1 / scale} listening={false}>
      <Tag
        fill="rgba(12, 14, 18, 0.88)"
        cornerRadius={4}
        pointerDirection="down"
        pointerWidth={10}
        pointerHeight={6}
      />
      <Text
        text={templateSizeText(template, units)}
        fontFamily={FONT}
        fontSize={14}
        fontStyle="bold"
        fill="#ffffff"
        padding={6}
      />
    </Label>
  )
}

/**
 * Hit targets of a pinned template for the Select tool: its outline and its
 * origin handle, never its inside, so tokens under a template stay clickable.
 */
function TemplateHit({
  template,
  grid,
  scale,
  selected,
}: {
  template: AoeTemplate
  grid: AoeGrid
  scale: number
  /** The origin handle grabs only a selected template (it often sits on a token's center). */
  selected: boolean
}) {
  const circle = templateCircle(template, grid)
  const polygon = circle ? null : templatePolygon(template, grid)
  const outline = {
    name: 'template',
    id: template.id,
    stroke: 'transparent',
    strokeWidth: 1 / scale,
    hitStrokeWidth: 12 / scale,
    fillEnabled: false,
  }
  return (
    <Group>
      {circle && <Circle x={circle.x} y={circle.y} radius={circle.r} {...outline} />}
      {polygon && <Line points={polygon} closed {...outline} />}
      {selected && (
        <Circle
          name="template"
          id={template.id}
          x={template.originX}
          y={template.originY}
          radius={9 / scale}
          fill="transparent"
        />
      )}
    </Group>
  )
}

/**
 * Templates and the ruler in the DM window: pinned templates (dashed when hidden
 * from players), the one being placed with its size, what the placed or
 * selected template affects, and the ruler.
 */
export function Annotations({ scale, cover }: { scale: number; cover: Rect }) {
  const scene = useActiveScene()
  const rule = useCampaign((c) => c.settings.aoeCoverage)
  const diagonalRule = useCampaign((c) => c.settings.diagonalRule)
  const units = useCampaign((c) => c.settings.units)
  const temp = useUiStore((s) => s.tempTemplate)
  const selection = useUiStore((s) => s.selection)
  const liveDrag = useUiStore((s) => s.liveDrag)
  const measurement = useUiStore((s) => s.measurement)
  const { grid } = scene
  const pinned = scene.templates.map((template) => livePlaced(template, liveDrag))
  const highlighted = [
    ...pinned.filter((template) => selection.includes(template.id)),
    ...(temp ? [temp] : []),
  ]
  const ruler = measurement && measurement.points.length >= 2 ? measurement.points : null
  const length = ruler ? rulerLength(ruler, grid, diagonalRule) : null
  return (
    <>
      {highlighted.map((template) => (
        <AffectedMarks
          key={`affected:${template.id}`}
          template={template}
          scene={scene}
          rule={rule}
          scale={scale}
          cover={cover}
          liveDrag={liveDrag}
        />
      ))}
      {pinned.map((template) => (
        <Group key={template.id} opacity={template.visibleToPlayers ? 1 : 0.7}>
          <TemplateShape
            template={template}
            grid={grid}
            scale={scale}
            dashed={!template.visibleToPlayers}
            emphasis={selection.includes(template.id)}
          />
          <TemplateHit
            template={template}
            grid={grid}
            scale={scale}
            selected={selection.includes(template.id)}
          />
        </Group>
      ))}
      {temp && (
        <>
          <TemplateShape
            template={temp}
            grid={grid}
            scale={scale}
            dashed={!temp.visibleToPlayers}
            emphasis
          />
          <SizeLabel template={temp} grid={grid} units={units} scale={scale} />
        </>
      )}
      {ruler && length && (
        <RulerShape
          points={ruler}
          label={rulerLabel(length.feet, length.cells, units)}
          scale={scale}
        />
      )}
    </>
  )
}
