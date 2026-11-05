import { useEffect, useState } from 'react'
import { makeThumbnail } from '../assets/upload/imageClient'
import { getAssetBlob } from '../persistence/assetBlobs'
import { getThumbnailBlob, putThumbnail } from '../persistence/db'

/**
 * Object URLs of library thumbnails (DM only). Thumbnails are made at import;
 * an asset that arrived without one (later: a gist pull) gets it on first view.
 */
const urls = new Map<string, Promise<string | null>>()

async function load(assetId: string): Promise<string | null> {
  let thumbnail = await getThumbnailBlob(assetId)
  if (!thumbnail) {
    const blob = await getAssetBlob(assetId)
    if (!blob) return null
    thumbnail = await makeThumbnail(blob)
    await putThumbnail(assetId, thumbnail).catch(() => undefined)
  }
  return URL.createObjectURL(thumbnail)
}

function thumbnailUrl(assetId: string): Promise<string | null> {
  let url = urls.get(assetId)
  if (!url) {
    const loading = load(assetId).catch(() => null)
    // A failure (missing blob, worker hiccup) is not cached: the next view retries.
    void loading.then((value) => {
      if (value === null && urls.get(assetId) === loading) urls.delete(assetId)
    })
    url = loading
    urls.set(assetId, url)
  }
  return url
}

/** Releases a deleted asset's thumbnail URL. */
export function forgetThumbnail(assetId: string): void {
  const url = urls.get(assetId)
  urls.delete(assetId)
  void url?.then((value) => {
    if (value) URL.revokeObjectURL(value)
  })
}

/** The thumbnail URL of an uploaded asset; null while loading or if the image is missing. */
export function useThumbnailUrl(assetId: string): string | null {
  const [state, setState] = useState<{ assetId: string; url: string | null } | null>(null)
  useEffect(() => {
    let alive = true
    void thumbnailUrl(assetId).then((url) => {
      if (alive) setState({ assetId, url })
    })
    return () => {
      alive = false
    }
  }, [assetId])
  return state?.assetId === assetId ? state.url : null
}
