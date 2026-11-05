import { LoaderCircle, Unplug } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PING_MS } from '../canvas/PingRipple'
import { getAssetBlob } from '../persistence/assetBlobs'
import type { Id, PlayerViewState } from '../state/types'
import { connectPlayer } from '../sync/playerClient'
import { PlayerCanvas, type PlayerPing } from './PlayerCanvas'

/** Hides the mouse pointer after a moment without movement (the window is on a TV). */
function useAutoHidingCursor(): boolean {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    let timer = setTimeout(() => setHidden(true), 2000)
    const onMove = () => {
      setHidden(false)
      clearTimeout(timer)
      timer = setTimeout(() => setHidden(true), 2000)
    }
    window.addEventListener('pointermove', onMove)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', onMove)
    }
  }, [])
  return hidden
}

/** An object URL for an uploaded image (the blackout splash), read by id from IndexedDB. */
function useBlobUrl(assetId: Id | null): string | null {
  const [state, setState] = useState<{ assetId: Id; url: string } | null>(null)
  useEffect(() => {
    if (assetId === null) return
    let url: string | null = null
    let alive = true
    getAssetBlob(assetId).then(
      (blob) => {
        if (!alive || !blob) return
        url = URL.createObjectURL(blob)
        setState({ assetId, url })
      },
      () => undefined,
    )
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
      // Never hand out a revoked URL if the same image comes back later.
      setState(null)
    }
  }, [assetId])
  return state !== null && state.assetId === assetId ? state.url : null
}

function Blackout({ splashAssetId }: { splashAssetId: Id | null }) {
  const url = useBlobUrl(splashAssetId)
  return (
    <div data-testid="player-blackout" className="flex h-full items-center justify-center bg-black">
      {url && <img src={url} alt="" className="max-h-full max-w-full object-contain" />}
    </div>
  )
}

function Connecting() {
  return (
    <div className="flex h-full items-center justify-center bg-black text-neutral-300">
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-3 text-center"
      >
        <LoaderCircle aria-hidden className="size-6 animate-spin text-neutral-500" />
        <p className="text-base">Connecting to the DM window…</p>
        <p className="max-w-sm text-sm text-neutral-400">
          Open this window from the DM screen with “Open player window”. Press F11 for full screen.
        </p>
      </div>
    </div>
  )
}

/**
 * Presentation window (`#/player`): no UI chrome, shown on a TV or projector.
 * It renders only the PlayerViewState the DM window sends over the sync channel
 * (CLAUDE.md, "Projection rule"), reads image blobs by id, and never writes
 * campaign state. After the DM window goes away it keeps the last frame with a
 * small badge.
 */
export function PlayerApp() {
  const [view, setView] = useState<PlayerViewState | null>(null)
  const [dmGone, setDmGone] = useState(false)
  const [pings, setPings] = useState<PlayerPing[]>([])
  const cursorHidden = useAutoHidingCursor()

  useEffect(
    () =>
      connectPlayer({
        onView: (state) => {
          setView(state)
          setDmGone(false)
        },
        onPing: ({ id, x, y, sceneId }) => {
          setPings((current) => [...current, { id, x, y, sceneId, startedAt: performance.now() }])
          setTimeout(() => setPings((current) => current.filter((p) => p.id !== id)), PING_MS)
        },
        onDmGone: () => setDmGone(true),
      }),
    [],
  )

  if (!view) return <Connecting />
  return (
    <div className={`relative h-full w-full bg-black ${cursorHidden ? 'cursor-none' : ''}`}>
      {view.blackout ? (
        <Blackout splashAssetId={view.splashAssetId} />
      ) : (
        <PlayerCanvas
          scene={view.scene}
          pings={pings.filter((ping) => ping.sceneId === view.scene.sceneId)}
        />
      )}
      {dmGone && (
        <p
          role="status"
          className="absolute top-3 right-3 flex items-center gap-2 rounded-full bg-neutral-900/80 px-3 py-1.5 text-sm text-neutral-300"
        >
          <Unplug aria-hidden className="size-4" />
          DM window disconnected
        </p>
      )}
    </div>
  )
}
