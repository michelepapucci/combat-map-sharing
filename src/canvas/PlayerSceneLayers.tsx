import Konva from 'konva'
import { useEffect, useRef, type ReactNode } from 'react'
import { Group, Layer } from 'react-konva'
import type { Rect } from '../geometry/types'
import type { Id, PlayerViewScene } from '../state/types'
import { FogLayer } from './FogLayer'
import { GridShape } from './GridShape'
import { ItemImage } from './ItemImage'
import { PingRipple } from './PingRipple'
import { TokenShape } from './TokenShape'
import { TemplateShape } from './TemplateShape'
import { RulerShape } from './RulerShape'
import { rulerLabel } from '../geometry/ruler'
import { ActiveTurnRing } from './ActiveTurnRing'

/** A ping in a window's own clock: when it started there. */
export interface ScenePing {
  id: Id
  x: number
  y: number
  startedAt: number
}

const FADE_SECONDS = 0.45

/** Fades its content in when mounted with `animate` (an item the DM just revealed). */
function FadeIn({ animate, children }: { animate: boolean; children: ReactNode }) {
  const ref = useRef<Konva.Group>(null)
  const animateOnMount = useRef(animate)
  useEffect(() => {
    const node = ref.current
    if (!node || !animateOnMount.current) return
    node.opacity(0)
    const tween = new Konva.Tween({ node, duration: FADE_SECONDS, opacity: 1 })
    tween.play()
    return () => {
      tween.destroy()
      node.opacity(1)
    }
  }, [])
  return <Group ref={ref}>{children}</Group>
}

const NO_FADES: ReadonlySet<Id> = new Set()

/**
 * Everything a PlayerViewScene draws, as Konva layers for a stage whose
 * transform is the camera: map, grid, props, tokens, fail-closed fog and pings.
 * Used by the player window and by "Preview as players" in the DM window, so
 * the preview matches the TV by construction. Props only.
 */
export function PlayerSceneLayers({
  scene,
  cover,
  scale,
  pings,
  fresh = NO_FADES,
  clipToView,
}: {
  scene: PlayerViewScene
  /** The world area on screen; fog covers all of it (fail-closed). */
  cover: Rect
  /** Stage scale, for constant-size pings. */
  scale: number
  pings: readonly ScenePing[]
  /** Items that should fade in (revealed while the scene is on screen). */
  fresh?: ReadonlySet<Id>
  /** Draw nothing outside the players' view (the player window); the preview shows more. */
  clipToView: boolean
}) {
  const { grid, view } = scene
  const turnTokens = scene.tokens.filter((token) => token.active === true)
  const clip = clipToView
    ? { clipX: view.x, clipY: view.y, clipWidth: view.width, clipHeight: view.height }
    : {}
  return (
    <>
      <Layer listening={false} {...clip}>
        {scene.map.map((item) => (
          <FadeIn key={item.id} animate={fresh.has(item.id)}>
            <ItemImage {...item} listening={false} />
          </FadeIn>
        ))}
      </Layer>
      <Layer listening={false} {...clip}>
        {grid.visible && (
          <GridShape
            size={grid.size}
            offsetX={grid.offsetX}
            offsetY={grid.offsetY}
            color={grid.color}
            opacity={grid.opacity}
          />
        )}
        {scene.props.map((item) => (
          <FadeIn key={item.id} animate={fresh.has(item.id)}>
            <ItemImage {...item} listening={false} />
          </FadeIn>
        ))}
        {scene.tokens.map((token) => (
          <FadeIn key={token.id} animate={fresh.has(token.id)}>
            <TokenShape
              id={token.id}
              assetId={token.assetId}
              x={token.x}
              y={token.y}
              size={token.width}
              rotation={token.rotation}
              opacity={token.opacity}
              color={token.color}
              badge={token.badge}
              label={token.label}
              hpFraction={token.hpFraction}
              conditions={token.conditions}
              listening={false}
            />
          </FadeIn>
        ))}
      </Layer>
      {/* The current turn's ring on its own small layer: its pulse never redraws the tokens. */}
      {turnTokens.length > 0 && (
        <Layer listening={false} {...clip}>
          {turnTokens.map((token) => (
            <FadeIn key={`turn:${token.id}`} animate={fresh.has(token.id)}>
              <ActiveTurnRing x={token.x} y={token.y} radius={token.width / 2} />
            </FadeIn>
          ))}
        </Layer>
      )}
      {scene.fog && <FogLayer cover={cover} fog={scene.fog} mode="player" />}
      {/* Above the fog: templates and the ruler are what the DM chose to show. */}
      <Layer listening={false} {...clip}>
        {scene.templates.map((template) => (
          <TemplateShape key={template.id} template={template} grid={grid} scale={scale} />
        ))}
        {scene.ruler && (
          <RulerShape
            points={scene.ruler.points}
            label={rulerLabel(scene.ruler.feet, scene.ruler.cells, scene.ruler.units)}
            scale={scale}
          />
        )}
        {pings.map((ping) => (
          <PingRipple
            key={ping.id}
            x={ping.x}
            y={ping.y}
            startedAt={ping.startedAt}
            scale={scale}
          />
        ))}
      </Layer>
    </>
  )
}
