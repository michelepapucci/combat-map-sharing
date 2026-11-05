import { PING_MS } from '../canvas/PingRipple'
import { visibleRect } from '../geometry/camera'
import type { Point } from '../geometry/types'
import { projectForPlayers } from '../projection/projectForPlayers'
import { createSceneMemory } from '../state/defaults'
import { newId } from '../state/ids'
import type { Id, PlayerCameraMode, PlayerViewState } from '../state/types'
import { setUnrecorded, useCampaignStore } from '../store/campaign'
import { useDevicePrefs } from '../store/devicePrefs'
import { useSessionStore } from '../store/session'
import { notify, useUiStore } from '../store/ui'
import { createDmSync, type DmSync } from '../sync/dmSync'

/**
 * What the players see (SPEC §5.9): the player sync of this DM tab, pings,
 * camera modes, pushed views and blackout. The sync runs only while this tab
 * holds the DM lock (started and stopped by the session).
 */

let sync: DmSync | null = null
let unsubscribe: (() => void) | null = null

function project(): PlayerViewState | null {
  const { campaign } = useCampaignStore.getState()
  if (!campaign) return null
  return projectForPlayers(campaign, useUiStore.getState(), useDevicePrefs.getState())
}

export function startPresentation(): void {
  if (sync) return
  const current = createDmSync({
    project,
    onPlayers: (count, change) => {
      useSessionStore.setState({ players: count })
      notify(change === 'connected' ? 'Player window connected.' : 'Player window disconnected.')
    },
  })
  sync = current
  const invalidate = () => current.invalidate()
  // The last change before closing must still reach the players (the throttle may hold it).
  const flush = () => current.flush()
  window.addEventListener('pagehide', flush)
  const stops = [
    useCampaignStore.subscribe((state, previous) => {
      if (state.campaign !== previous.campaign) invalidate()
    }),
    // Only the UI fields the projection reads (hover and selection changes are not sent).
    useUiStore.subscribe((state, previous) => {
      if (
        state.liveDrag !== previous.liveDrag ||
        state.dmCamera !== previous.dmCamera ||
        state.dmViewport !== previous.dmViewport ||
        state.measurement !== previous.measurement ||
        state.tempTemplate !== previous.tempTemplate
      ) {
        invalidate()
      }
    }),
    useDevicePrefs.subscribe(invalidate),
    () => window.removeEventListener('pagehide', flush),
  ]
  unsubscribe = () => {
    for (const stop of stops) stop()
  }
}

/** This tab stopped being the DM (handover, steal): the new DM tab takes over the players. */
export function stopPresentation(): void {
  unsubscribe?.()
  unsubscribe = null
  sync?.dispose()
  sync = null
  useSessionStore.setState({ players: 0 })
}

/** A ping at a world point, shown in both windows (Ping tool or Alt+click). */
export function ping(at: Point): void {
  const { campaign } = useCampaignStore.getState()
  if (!campaign) return
  const id: Id = newId()
  useUiStore.setState((s) => ({
    pings: [...s.pings, { id, x: at.x, y: at.y, createdAt: performance.now() }],
  }))
  setTimeout(() => {
    useUiStore.setState((s) => ({ pings: s.pings.filter((p) => p.id !== id) }))
  }, PING_MS)
  // During blackout players see nothing, pings included.
  if (!campaign.presentation.blackout) {
    sync?.ping({ id, x: at.x, y: at.y, sceneId: campaign.activeSceneId })
  }
}

export function setCameraMode(mode: PlayerCameraMode): void {
  setUnrecorded((draft) => {
    draft.presentation.cameraMode = mode
  })
}

/** "Push view to players": the area the DM sees becomes the players' view of this scene. */
export function pushView(): void {
  const { campaign } = useCampaignStore.getState()
  const { dmCamera, dmViewport } = useUiStore.getState()
  if (!campaign || dmViewport.width === 0) return
  const view = visibleRect(dmCamera, dmViewport)
  setUnrecorded((draft) => {
    const scene = draft.scenes.find((s) => s.id === draft.activeSceneId)
    if (!scene) return
    const memory = (draft.sceneMemory[scene.id] ??= createSceneMemory(scene))
    memory.playerView = view
    draft.presentation.cameraMode = 'pushed'
  })
  notify('View pushed to players.')
}

export function setBlackout(blackout: boolean): void {
  setUnrecorded((draft) => {
    draft.presentation.blackout = blackout
  })
}

export function setSplash(assetId: Id | null): void {
  setUnrecorded((draft) => {
    draft.presentation.splashAssetId = assetId
  })
}
