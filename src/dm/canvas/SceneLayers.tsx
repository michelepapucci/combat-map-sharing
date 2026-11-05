import { memo } from 'react'
import { ItemImage } from '../../canvas/ItemImage'
import { TokenShape } from '../../canvas/TokenShape'
import type { Item, Token } from '../../state/types'
import { useUiStore } from '../../store/ui'

/** Hidden items show at half opacity in the DM window (plus a badge from the overlay). */
const HIDDEN_FACTOR = 0.5

/** A map or prop item, at its live drag position while being dragged. */
export const DmItem = memo(function DmItem({ item }: { item: Item }) {
  const live = useUiStore((s) => s.liveDrag?.[item.id])
  return (
    <ItemImage
      id={item.id}
      assetId={item.assetId}
      x={live?.x ?? item.x}
      y={live?.y ?? item.y}
      width={item.width}
      height={item.height}
      rotation={item.rotation}
      opacity={item.opacity * (item.hidden ? HIDDEN_FACTOR : 1)}
    />
  )
})

export const DmToken = memo(function DmToken({ token }: { token: Token }) {
  const live = useUiStore((s) => s.liveDrag?.[token.id])
  return (
    <TokenShape
      id={token.id}
      assetId={token.assetId}
      x={live?.x ?? token.x}
      y={live?.y ?? token.y}
      size={token.width}
      rotation={token.rotation}
      opacity={token.opacity * (token.hidden ? HIDDEN_FACTOR : 1)}
      color={token.color}
      badge={token.badge}
      label={token.showLabel ? token.label : null}
      hpFraction={token.hp ? token.hp.current / token.hp.max : null}
      hpPrivate={token.hp !== null && !token.hp.publicBar}
      conditions={token.conditions}
    />
  )
})

export function DmItems({ items }: { items: readonly Item[] }) {
  return items.map((item) => <DmItem key={item.id} item={item} />)
}

export function DmTokens({ tokens }: { tokens: readonly Token[] }) {
  return tokens.map((token) => <DmToken key={token.id} token={token} />)
}
