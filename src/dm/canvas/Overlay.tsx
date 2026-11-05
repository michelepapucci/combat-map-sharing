import type Konva from 'konva'
import { useLayoutEffect, useRef } from 'react'
import { Circle, Group, Label, Line, Path, Rect, Tag, Text, Transformer } from 'react-konva'
import { parseHexColor } from '../../canvas/color'
import { ActiveTurnRing } from '../../canvas/ActiveTurnRing'
import { PingRipple } from '../../canvas/PingRipple'
import { TokenShape } from '../../canvas/TokenShape'
import { screenToWorld, worldToScreen } from '../../geometry/camera'
import { worldDistanceFeet } from '../../geometry/distance'
import { visionRadiusPx, visionSources } from '../../geometry/fog'
import { formatLength } from '../../geometry/units'
import { itemBounds, rectFromPoints } from '../../geometry/rect'
import { isRightAngle, snapToLine } from '../../geometry/snap'
import type { Rect as RectShape } from '../../geometry/types'
import { allItems, findItem, isItemMovable } from '../../state/sceneOps'
import type { FogEditMode, Id, Item, Scene, Token } from '../../state/types'
import { transformItems, type ItemGeometry } from '../../store/actions'
import { activeToken } from '../../store/initiativeActions'
import { useActiveScene, useCampaign } from '../../store/campaign'
import { useUiStore, type FogDraft } from '../../store/ui'
import { useCssColor } from './useCssColor'

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"

// Icon path data from Lucide (ISC license), drawn as strokes in a 24 x 24 box.
const ICON_EYE_OFF = [
  'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49',
  'M14.084 14.158a3 3 0 0 1-4.242-4.242',
  'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143',
  'm2 2 20 20',
]
const ICON_LOCK = [
  'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z',
  'M7 11V7a5 5 0 0 1 10 0v4',
]

/** A theme color at the given alpha (CSS hex in, rgba out). */
function translucent(color: string, alpha: number): string {
  const rgb = parseHexColor(color)
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : color
}

export interface OverlayProps {
  marquee: RectShape | null
  calibration: RectShape | null
}

function livePosition(item: Item, liveDrag: Record<Id, { x: number; y: number }> | null) {
  const live = liveDrag?.[item.id]
  return live ? { ...item, x: live.x, y: live.y } : item
}

/** A rotated outline matching an item, with a constant screen-space stroke. */
function Outline({ item, color, dashed }: { item: Item; color: string; dashed: boolean }) {
  return (
    <Rect
      x={item.x}
      y={item.y}
      width={item.width}
      height={item.height}
      offsetX={item.width / 2}
      offsetY={item.height / 2}
      rotation={item.rotation}
      stroke={color}
      strokeWidth={dashed ? 2 : 1.5}
      dash={dashed ? [6, 4] : undefined}
      strokeScaleEnabled={false}
      listening={false}
      perfectDrawEnabled={false}
    />
  )
}

/** "Hidden" and "locked" chips at an item's top-right corner, constant size on screen. */
function StateBadges({ item, zoom }: { item: Item; zoom: number }) {
  const icons = [item.hidden ? ICON_EYE_OFF : null, item.locked ? ICON_LOCK : null].filter(
    (icon): icon is string[] => icon !== null,
  )
  if (icons.length === 0) return null
  const bounds = itemBounds(item)
  return (
    <Group
      x={bounds.x + bounds.width}
      y={bounds.y}
      scaleX={1 / zoom}
      scaleY={1 / zoom}
      listening={false}
    >
      {icons.map((paths, i) => (
        <Group key={i} x={-10 - i * 22} y={10}>
          <Circle radius={10} fill="rgba(12, 14, 18, 0.85)" stroke="#ffffff" strokeWidth={1} />
          {paths.map((d) => (
            <Path
              key={d}
              data={d}
              x={-6}
              y={-6}
              scaleX={0.5}
              scaleY={0.5}
              stroke="#ffffff"
              strokeWidth={2.2}
              lineCap="round"
              lineJoin="round"
            />
          ))}
        </Group>
      ))}
    </Group>
  )
}

/** Ghost at the origin, path line and distance label for a token being dragged (SPEC §5.1). */
function DragTrail({
  token,
  to,
  scene,
  zoom,
  color,
  showLabel,
}: {
  token: Token
  to: { x: number; y: number }
  scene: Scene
  zoom: number
  color: string
  showLabel: boolean
}) {
  const rule = useCampaign((c) => c.settings.diagonalRule)
  const units = useCampaign((c) => c.settings.units)
  const feet = worldDistanceFeet(token, to, scene.grid.size, scene.grid.feetPerCell, rule)
  return (
    <Group listening={false}>
      <TokenShape
        assetId={token.assetId}
        x={token.x}
        y={token.y}
        size={token.width}
        rotation={token.rotation}
        opacity={0.3}
        color={token.color}
        badge={token.badge}
        listening={false}
      />
      <Line
        points={[token.x, token.y, to.x, to.y]}
        stroke={color}
        strokeWidth={2.5}
        dash={[8, 6]}
        lineCap="round"
        strokeScaleEnabled={false}
      />
      {showLabel && (
        <Label x={to.x} y={to.y - token.height / 2 - 6 / zoom} scaleX={1 / zoom} scaleY={1 / zoom}>
          <Tag
            fill="rgba(12, 14, 18, 0.88)"
            cornerRadius={4}
            pointerDirection="down"
            pointerWidth={10}
            pointerHeight={6}
          />
          <Text
            text={formatLength(feet, units)}
            fontFamily={FONT}
            fontSize={14}
            fontStyle="bold"
            fill="#ffffff"
            padding={6}
          />
        </Label>
      )}
    </Group>
  )
}

/**
 * The vision radius of a selected token, as a dashed ring (shown with fog on or
 * off, following a drag: where it will see after the drop). Dotted and dimmer
 * when the token reveals no fog for players (an enemy, a hidden token...).
 */
function VisionRing({
  token,
  at,
  scene,
  reveals,
  showLabel,
  zoom,
  color,
}: {
  token: Token
  at: { x: number; y: number }
  scene: Scene
  reveals: boolean
  showLabel: boolean
  zoom: number
  color: string
}) {
  const units = useCampaign((c) => c.settings.units)
  if (token.visionFt === null) return null
  const r = visionRadiusPx(token.visionFt, scene.grid)
  if (!(r > 0) || !Number.isFinite(r)) return null
  return (
    <Group listening={false} opacity={reveals ? 0.9 : 0.55}>
      <Circle
        x={at.x}
        y={at.y}
        radius={r}
        stroke={color}
        strokeWidth={1.5}
        dash={reveals ? [10, 6] : [2, 6]}
        lineCap="round"
        strokeScaleEnabled={false}
        perfectDrawEnabled={false}
      />
      {showLabel && (
        <Label x={at.x} y={at.y - r - 4 / zoom} scaleX={1 / zoom} scaleY={1 / zoom}>
          <Tag
            fill="rgba(12, 14, 18, 0.88)"
            cornerRadius={4}
            pointerDirection="down"
            pointerWidth={8}
            pointerHeight={5}
          />
          <Text
            text={`Vision ${formatLength(token.visionFt, units)}${reveals ? '' : ' (reveals no fog)'}`}
            fontFamily={FONT}
            fontSize={12}
            fill="#ffffff"
            padding={4}
          />
        </Label>
      )}
    </Group>
  )
}

function CalibrationBox({
  box,
  cells,
  color,
  zoom,
}: {
  box: RectShape
  cells: number
  color: string
  zoom: number
}) {
  const lines: number[][] = []
  for (let i = 1; i < cells; i++) {
    const x = box.x + (box.width * i) / cells
    const y = box.y + (box.height * i) / cells
    lines.push([x, box.y, x, box.y + box.height], [box.x, y, box.x + box.width, y])
  }
  return (
    <Group listening={false}>
      <Rect
        {...box}
        stroke={color}
        strokeWidth={2}
        strokeScaleEnabled={false}
        fill="rgba(255,255,255,0.08)"
      />
      {lines.map((points, i) => (
        <Line
          key={i}
          points={points}
          stroke={color}
          strokeWidth={1}
          dash={[4, 4]}
          strokeScaleEnabled={false}
        />
      ))}
      <Label x={box.x} y={box.y - 28 / zoom} scaleX={1 / zoom} scaleY={1 / zoom}>
        <Tag
          fill="rgba(12, 14, 18, 0.88)"
          cornerRadius={4}
          pointerDirection="down"
          pointerWidth={8}
          pointerHeight={5}
        />
        <Text
          text={`${cells} × ${cells} ${cells === 1 ? 'cell' : 'cells'}`}
          fontFamily={FONT}
          fontSize={13}
          fill="#ffffff"
          padding={5}
        />
      </Label>
    </Group>
  )
}

/** The manual fog shape being drawn: light for reveal, dark for hide. */
function FogDraftPreview({
  draft,
  mode,
  zoom,
  accent,
}: {
  draft: FogDraft
  mode: FogEditMode
  zoom: number
  accent: string
}) {
  const fill = mode === 'reveal' ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.45)'
  const outline = { stroke: accent, strokeWidth: 1.5 / zoom, dash: [6 / zoom, 4 / zoom] }
  if (draft.type === 'rect') {
    return (
      <Rect {...rectFromPoints(draft.from, draft.to)} fill={fill} {...outline} listening={false} />
    )
  }
  if (draft.type === 'brush') {
    const points = draft.points.flatMap((p) => [p.x, p.y])
    const first = draft.points[0]
    return draft.points.length === 1 && first ? (
      <Circle x={first.x} y={first.y} radius={draft.radius} fill={fill} listening={false} />
    ) : (
      <Line
        points={points}
        stroke={fill}
        strokeWidth={draft.radius * 2}
        lineCap="round"
        lineJoin="round"
        listening={false}
      />
    )
  }
  const corners = draft.cursor ? [...draft.points, draft.cursor] : draft.points
  const first = draft.points[0]
  return (
    <Group listening={false}>
      <Line points={corners.flatMap((p) => [p.x, p.y])} closed fill={fill} {...outline} />
      {first && (
        <Circle
          x={first.x}
          y={first.y}
          radius={6 / zoom}
          fill={accent}
          stroke="#000"
          strokeWidth={1 / zoom}
        />
      )}
    </Group>
  )
}

/**
 * Everything drawn above the scene in the DM window: hover and selection outlines,
 * the Transformer, hidden/locked badges, drag trails, the marquee, the
 * calibration box and the fog shape being drawn.
 */
export function Overlay({ marquee, calibration }: OverlayProps) {
  const scene = useActiveScene()
  const selection = useUiStore((s) => s.selection)
  const hoveredId = useUiStore((s) => s.hoveredId)
  const zoom = useUiStore((s) => s.dmCamera.zoom)
  const liveDrag = useUiStore((s) => s.liveDrag)
  const primaryId = useUiStore((s) => s.dragPrimaryId)
  const tool = useUiStore((s) => s.tool)
  const calibrationCells = useUiStore((s) => s.calibrationCells)
  const pings = useUiStore((s) => s.pings)
  const fogDraft = useUiStore((s) => s.fogDraft)
  const fogMode = useUiStore((s) => s.fogMode)
  const snapEnabled = useCampaign((c) => c.settings.snapEnabled)
  const npcVision = useCampaign((c) => c.settings.npcVision)
  const accent = useCssColor('--accent', '#e3a83b')
  const transformerRef = useRef<Konva.Transformer>(null)

  const selected = selection.flatMap((id) => findItem(scene, id) ?? [])
  const transformable = selected.filter((ref) => isItemMovable(scene, ref))
  const transformableKey = transformable.map((ref) => ref.item.id).join(',')
  const hasToken = transformable.some((ref) => ref.layer === 'tokens')
  // Several nodes resize as one axis-aligned box; on rotated items Konva would add skew.
  const resizable =
    !hasToken &&
    (transformable.length === 1 || transformable.every((ref) => isRightAngle(ref.item.rotation)))

  // Attach the Transformer to the Konva nodes of the transformable selection.
  useLayoutEffect(() => {
    const transformer = transformerRef.current
    const stage = transformer?.getStage()
    if (!transformer || !stage) return
    const ids = new Set(transformableKey === '' ? [] : transformableKey.split(','))
    const nodes = stage.find((node: Konva.Node) => ids.has(node.id()) && node.hasName('item'))
    transformer.nodes(nodes)
    transformer.getLayer()?.batchDraw()
  }, [transformableKey, transformerRef])

  const hovered =
    hoveredId !== null && !selection.includes(hoveredId) && tool === 'select'
      ? findItem(scene, hoveredId)
      : null

  const anchorDragBoundFunc = (_old: Konva.Vector2d, next: Konva.Vector2d, event: MouseEvent) => {
    const transformer = transformerRef.current
    const anchor = transformer?.getActiveAnchor()
    if (!transformer || !anchor || anchor.startsWith('rotater')) return next
    const nodes = transformer.nodes()
    const node = nodes[0]
    if (
      !snapEnabled ||
      event.altKey ||
      nodes.length !== 1 ||
      !node ||
      !isRightAngle(node.rotation())
    ) {
      return next
    }
    const { dmCamera, dmViewport } = useUiStore.getState()
    const world = screenToWorld(next, dmCamera, dmViewport)
    const { size, offsetX, offsetY } = scene.grid
    return worldToScreen(
      { x: snapToLine(world.x, offsetX, size), y: snapToLine(world.y, offsetY, size) },
      dmCamera,
      dmViewport,
    )
  }

  const onTransformEnd = () => {
    const transformer = transformerRef.current
    if (!transformer) return
    const changes: Record<Id, ItemGeometry> = {}
    for (const node of transformer.nodes()) {
      const ref = findItem(scene, node.id())
      if (!ref) continue
      const scaleX = node.scaleX()
      const scaleY = node.scaleY()
      node.scale({ x: 1, y: 1 })
      node.skew({ x: 0, y: 0 })
      changes[ref.item.id] = {
        x: node.x(),
        y: node.y(),
        width: ref.item.width * Math.abs(scaleX),
        height: ref.item.height * Math.abs(scaleY),
        rotation: node.rotation(),
      }
    }
    transformItems(changes)
  }

  const sources = new Set(visionSources(scene, { npcVision }).map((source) => source.tokenId))
  const sighted = selected.flatMap((ref) =>
    ref.layer === 'tokens' && (ref.item as Token).visionFt !== null ? [ref.item as Token] : [],
  )

  const dragged = liveDrag
    ? Object.entries(liveDrag).flatMap(([id, to]) => {
        const ref = findItem(scene, id)
        return ref?.layer === 'tokens' ? [{ token: ref.item as Token, to }] : []
      })
    : []

  const turn = activeToken(scene)

  return (
    <>
      {turn && scene.layerState.tokens.visible && (
        <ActiveTurnRing
          x={liveDrag?.[turn.id]?.x ?? turn.x}
          y={liveDrag?.[turn.id]?.y ?? turn.y}
          radius={turn.width / 2}
        />
      )}
      {sighted.map((token) => (
        <VisionRing
          key={token.id}
          token={token}
          at={liveDrag?.[token.id] ?? token}
          scene={scene}
          reveals={sources.has(token.id)}
          showLabel={sighted.length === 1}
          zoom={zoom}
          color={accent}
        />
      ))}
      {hovered && scene.layerState[hovered.layer].visible && (
        <Outline item={livePosition(hovered.item, liveDrag)} color={accent} dashed={false} />
      )}
      {selected
        .filter((ref) => !isItemMovable(scene, ref))
        .map((ref) => (
          <Outline key={ref.item.id} item={ref.item} color={accent} dashed />
        ))}
      {dragged.map(({ token, to }) => (
        <DragTrail
          key={token.id}
          token={token}
          to={to}
          scene={scene}
          zoom={zoom}
          color={accent}
          showLabel={token.id === primaryId || dragged.length === 1}
        />
      ))}
      {allItems(scene)
        .filter(
          ({ layer, item }) => scene.layerState[layer].visible && (item.hidden || item.locked),
        )
        .map(({ item }) => (
          <StateBadges key={item.id} item={livePosition(item, liveDrag)} zoom={zoom} />
        ))}
      <Transformer
        ref={transformerRef}
        visible={liveDrag === null}
        resizeEnabled={resizable}
        rotateEnabled
        keepRatio={false}
        flipEnabled={false}
        ignoreStroke
        rotationSnaps={[0, 90, 180, 270]}
        rotationSnapTolerance={4}
        rotateAnchorOffset={26}
        anchorSize={10}
        anchorCornerRadius={2}
        anchorStroke={accent}
        anchorFill="#ffffff"
        borderStroke={accent}
        borderStrokeWidth={1.5}
        anchorDragBoundFunc={anchorDragBoundFunc}
        boundBoxFunc={(oldBox, newBox) => (newBox.width < 6 || newBox.height < 6 ? oldBox : newBox)}
        onTransformEnd={onTransformEnd}
      />
      {marquee && (
        <Rect
          {...marquee}
          stroke={accent}
          strokeWidth={1}
          dash={[5, 4]}
          strokeScaleEnabled={false}
          fill={translucent(accent, 0.1)}
          listening={false}
        />
      )}
      {calibration && (
        <CalibrationBox box={calibration} cells={calibrationCells} color={accent} zoom={zoom} />
      )}
      {fogDraft && <FogDraftPreview draft={fogDraft} mode={fogMode} zoom={zoom} accent={accent} />}
      {pings.map((ping) => (
        <PingRipple key={ping.id} x={ping.x} y={ping.y} startedAt={ping.createdAt} scale={zoom} />
      ))}
    </>
  )
}
