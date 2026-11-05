import Konva from 'konva'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Group, Layer, Rect, Stage } from 'react-konva'
import { GridShape } from '../canvas/GridShape'
import { ItemImage } from '../canvas/ItemImage'
import { PingRipple } from '../canvas/PingRipple'
import { TokenShape } from '../canvas/TokenShape'
import { useDevicePixelRatio } from '../canvas/useDevicePixelRatio'
import { fitRect, stageTransform, visibleRect } from '../geometry/camera'
import type { Camera, Id, PlayerViewScene, ViewRect } from '../state/types'

/** A ping as the player window received it, timed from its arrival. */
export interface PlayerPing {
  id: Id
  x: number
  y: number
  sceneId: Id
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

interface Shown {
  sceneId: Id
  ids: ReadonlySet<Id>
  /** Items that appeared after the scene was first shown (the DM revealed them). */
  fresh: ReadonlySet<Id>
}

/**
 * Ids of items that appeared while this scene was already on screen. Kept in
 * state (updated during render when the ids change), so a new item mounts
 * already knowing it should fade in; a scene change fades nothing.
 */
function useFreshIds(scene: PlayerViewScene): ReadonlySet<Id> {
  const ids = [...scene.map, ...scene.props, ...scene.tokens].map((item) => item.id)
  const [shown, setShown] = useState<Shown>(() => ({
    sceneId: scene.sceneId,
    ids: new Set(ids),
    fresh: new Set(),
  }))
  const changed = shown.ids.size !== ids.length || ids.some((id) => !shown.ids.has(id))
  if (shown.sceneId !== scene.sceneId) {
    setShown({ sceneId: scene.sceneId, ids: new Set(ids), fresh: new Set() })
  } else if (changed) {
    const fresh = new Set(ids.filter((id) => !shown.ids.has(id) || shown.fresh.has(id)))
    setShown({ sceneId: scene.sceneId, ids: new Set(ids), fresh })
  }
  return shown.fresh
}

/** The players' camera: the DM's view rectangle fitted to this screen, or a fixed scale. */
function playerCamera(
  view: ViewRect,
  gridSize: number,
  lockedCellPx: number | null,
  size: { width: number; height: number },
): Camera {
  if (lockedCellPx !== null && gridSize > 0) {
    return {
      x: view.x + view.width / 2,
      y: view.y + view.height / 2,
      zoom: lockedCellPx / gridSize,
    }
  }
  return fitRect(view, size, 0)
}

/**
 * The player window's canvas: renders a PlayerViewScene only, with the shared
 * renderers, clipped to exactly the area the DM framed (`scene.view`), redrawn
 * sharply when the window moves to a screen with another pixel density. Items
 * the DM reveals (unhides) fade in; on a scene change nothing fades. Fog rendering arrives in milestone 5: until then a scene with fog on
 * is covered in black (fail-closed), and fog cannot be turned on before then.
 */
export function PlayerCanvas({ scene, pings }: { scene: PlayerViewScene; pings: PlayerPing[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const fresh = useFreshIds(scene)
  const dpr = useDevicePixelRatio()

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize({ width: Math.round(width), height: Math.round(height) })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const fades = (id: Id) => fresh.has(id)

  const camera = playerCamera(scene.view, scene.grid.size, scene.lockedCellPx, size)
  const transform = stageTransform(camera, size)
  const { grid, view } = scene
  // Players see exactly the framed area: nothing outside it is drawn (the rest stays black).
  const clip = { clipX: view.x, clipY: view.y, clipWidth: view.width, clipHeight: view.height }

  return (
    <div ref={containerRef} className="h-full w-full overflow-hidden bg-black">
      {size.width > 0 && size.height > 0 && (
        <Stage
          key={dpr}
          width={size.width}
          height={size.height}
          x={transform.x}
          y={transform.y}
          scaleX={transform.scale}
          scaleY={transform.scale}
          listening={false}
        >
          <Layer listening={false} {...clip}>
            {scene.map.map((item) => (
              <FadeIn key={item.id} animate={fades(item.id)}>
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
              <FadeIn key={item.id} animate={fades(item.id)}>
                <ItemImage {...item} listening={false} />
              </FadeIn>
            ))}
            {scene.tokens.map((token) => (
              <FadeIn key={token.id} animate={fades(token.id)}>
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
                  listening={false}
                />
              </FadeIn>
            ))}
          </Layer>
          {scene.fog && (
            <Layer listening={false}>
              <Rect {...visibleRect(camera, size)} fill="#000000" />
            </Layer>
          )}
          <Layer listening={false} {...clip}>
            {pings.map((ping) => (
              <PingRipple
                key={ping.id}
                x={ping.x}
                y={ping.y}
                startedAt={ping.startedAt}
                scale={transform.scale}
              />
            ))}
          </Layer>
        </Stage>
      )}
    </div>
  )
}
