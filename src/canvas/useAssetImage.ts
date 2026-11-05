import { useEffect, useState } from 'react'
import { loadAssetImage, peekAssetImage, type AssetImage } from '../assets/images'

/** The decoded image of a map or prop asset, or undefined while it loads (or if it failed). */
export function useAssetImage(assetId: string): AssetImage | undefined {
  const [loaded, setLoaded] = useState<{ assetId: string; image: AssetImage } | null>(null)
  const cached = peekAssetImage(assetId)

  useEffect(() => {
    if (peekAssetImage(assetId)) return
    let alive = true
    loadAssetImage(assetId).then(
      (image) => {
        if (alive) setLoaded({ assetId, image })
      },
      () => undefined, // Unknown or broken asset: keep the placeholder.
    )
    return () => {
      alive = false
    }
  }, [assetId])

  return cached ?? (loaded?.assetId === assetId ? loaded.image : undefined)
}
