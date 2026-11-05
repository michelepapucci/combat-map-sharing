import { useEffect, useState } from 'react'
import { loadAssetImage, peekAssetImage, retainAssetImage, type AssetImage } from '../assets/images'

/**
 * The decoded image of an asset, or undefined while it loads, if it failed, or
 * when `assetId` is null (nothing to load).
 */
export function useAssetImage(assetId: string | null): AssetImage | undefined {
  const [loaded, setLoaded] = useState<{ assetId: string; image: AssetImage } | null>(null)
  const cached = assetId === null ? undefined : peekAssetImage(assetId)

  useEffect(() => {
    if (assetId === null) return
    // Shown images are never evicted from the decoded-image cache.
    const release = retainAssetImage(assetId)
    let alive = true
    if (!peekAssetImage(assetId)) {
      loadAssetImage(assetId).then(
        (image) => {
          if (alive) setLoaded({ assetId, image })
        },
        () => undefined, // Unknown, missing or broken asset: keep the placeholder.
      )
    }
    return () => {
      alive = false
      release()
    }
  }, [assetId])

  return cached ?? (loaded !== null && loaded.assetId === assetId ? loaded.image : undefined)
}
