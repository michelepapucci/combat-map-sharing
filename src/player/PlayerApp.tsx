import { LoaderCircle } from 'lucide-react'

/**
 * Presentation window (`#/player`): no UI chrome, shown on a TV or projector.
 * Milestone 1 only renders the "connecting" state; the BroadcastChannel sync and
 * the canvas arrive in milestone 4. This window never writes campaign state.
 */
export function PlayerApp() {
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
