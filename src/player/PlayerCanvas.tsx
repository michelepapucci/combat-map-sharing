import { useEffect, useRef, useState } from 'react'
import { Stage } from 'react-konva'
import { PlayerSceneLayers } from '../canvas/PlayerSceneLayers'
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
 * the DM reveals (unhides) fade in; on a scene change nothing fades. Fog is
 * drawn fail-closed over the whole screen (PlayerSceneLayers / FogLayer).
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

  const camera = playerCamera(scene.view, scene.grid.size, scene.lockedCellPx, size)
  const transform = stageTransform(camera, size)

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
          <PlayerSceneLayers
            scene={scene}
            cover={visibleRect(camera, size)}
            scale={transform.scale}
            pings={pings}
            fresh={fresh}
            clipToView
          />
        </Stage>
      )}
    </div>
  )
}
