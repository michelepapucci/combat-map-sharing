import { memo } from 'react'
import { Image } from 'react-konva'
import { useAssetImage } from './useAssetImage'

export interface ItemImageProps {
  /** Konva node id: the item id (used to find nodes for the Transformer). */
  id: string
  assetId: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  listening?: boolean
}

/**
 * A map or prop item: an image centered on (x, y), rotated about its center.
 * Shows a translucent placeholder until the image has loaded. Shared by the DM
 * and player canvases; props only, no store access.
 */
export const ItemImage = memo(function ItemImage({
  id,
  assetId,
  x,
  y,
  width,
  height,
  rotation,
  opacity,
  listening = true,
}: ItemImageProps) {
  const image = useAssetImage(assetId)
  return (
    <Image
      id={id}
      name="item"
      image={image}
      fill={image ? undefined : 'rgba(128, 128, 128, 0.35)'}
      x={x}
      y={y}
      width={width}
      height={height}
      offsetX={width / 2}
      offsetY={height / 2}
      rotation={rotation}
      opacity={opacity}
      listening={listening}
      perfectDrawEnabled={false}
    />
  )
})
