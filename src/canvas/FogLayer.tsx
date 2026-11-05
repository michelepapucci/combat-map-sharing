import { memo, useMemo } from 'react'
import { Layer, Shape } from 'react-konva'
import { exploredTiles, type ExploredTile } from '../geometry/fogRaster'
import type { Rect } from '../geometry/types'
import type { FogEditMode, FogMask, FogShape } from '../state/types'
import { DM_TINT_OPACITY, cachedTileImage, drawFog, trimTileCache } from './fogCanvas'

export { DM_TINT_OPACITY, EXPLORED_CLEAR } from './fogCanvas'

export interface FogLayerProps {
  /**
   * World rectangle the fog must cover (the area on screen, or larger). The fog
   * always covers the whole layer canvas and culls explored tiles against it at
   * draw time, so this only matters if the stage is ever rotated.
   */
  cover?: Rect | null
  fog: {
    visible: readonly { x: number; y: number; r: number }[]
    /** null = explored memory off. */
    explored: FogMask | null
    manual: readonly { mode: FogEditMode; shape: FogShape }[]
  }
  /** 'player': fail-closed opaque fog; 'dm': the same regions as a light tint. */
  mode: 'player' | 'dm'
}

/** Tile lists by mask object, then by content for a few recent masks. */
const tilesByMask = new WeakMap<FogMask, ExploredTile[]>()
const recentTiles: { key: string; tiles: ExploredTile[] }[] = []
const RECENT_TILE_LISTS = 4

/**
 * The explored tiles of a mask. Every view message (and every re-projection
 * for "Preview as players") brings a new mask object with the same content
 * most of the time, so tiles are reused by content, not only by identity.
 */
function tilesFor(mask: FogMask): ExploredTile[] {
  const known = tilesByMask.get(mask)
  if (known) return known
  const key = `${mask.cellPx}|${JSON.stringify(mask.chunks)}`
  let entry = recentTiles.find((recent) => recent.key === key)
  if (!entry) {
    entry = { key, tiles: exploredTiles(mask) }
    recentTiles.unshift(entry)
    recentTiles.length = Math.min(recentTiles.length, RECENT_TILE_LISTS)
  }
  tilesByMask.set(mask, entry.tiles)
  return entry.tiles
}

/**
 * Fog of war as its own Konva layer (SPEC §5.6): black outside explored areas,
 * semi-dark over explored-but-not-visible ones, clear inside visible ones, then
 * the manual edits in order. It starts opaque over the whole canvas and cuts
 * regions out (fail closed, CLAUDE.md "Projection rule"). In 'dm' mode the layer
 * is drawn at DM_TINT_OPACITY so the DM sees through it. Shared by the player
 * window, the DM canvas and "Preview as players"; props only.
 */
export const FogLayer = memo(function FogLayer({ cover = null, fog, mode }: FogLayerProps) {
  const { visible, explored, manual } = fog
  // Tile lists are reused by content; tile canvases are cached by content too.
  const tiles = useMemo(() => (explored ? tilesFor(explored) : []), [explored])
  const cellPx = explored?.cellPx ?? 0
  return (
    // Anything but 'dm' is the opaque player fog.
    <Layer listening={false} opacity={mode === 'dm' ? DM_TINT_OPACITY : 1}>
      <Shape
        listening={false}
        perfectDrawEnabled={false}
        sceneFunc={(context) => {
          // The native context this draw targets (Konva's wrapper has no getTransform).
          // oxlint-disable-next-line no-underscore-dangle -- Konva's documented, typed handle on it
          const ctx = context._context
          const drawn = drawFog(
            ctx,
            { width: ctx.canvas.width, height: ctx.canvas.height },
            { visible, tiles, cellPx, manual },
            cachedTileImage,
            cover,
          )
          trimTileCache(drawn)
        }}
      />
    </Layer>
  )
})
