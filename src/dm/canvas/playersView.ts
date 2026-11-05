import { useMemo } from 'react'
import { projectForPlayers } from '../../projection/projectForPlayers'
import type { PlayerViewState } from '../../state/types'
import { useCampaignStore } from '../../store/campaign'
import { useDevicePrefs } from '../../store/devicePrefs'
import { useUiStore } from '../../store/ui'

/**
 * What the player window gets right now: projectForPlayers over the live
 * campaign and the UI fields it reads. For "Preview as players", so the preview
 * matches the TV by construction.
 */
export function usePlayersView(): PlayerViewState | null {
  const campaign = useCampaignStore((s) => s.campaign)
  const liveDrag = useUiStore((s) => s.liveDrag)
  const dmCamera = useUiStore((s) => s.dmCamera)
  const dmViewport = useUiStore((s) => s.dmViewport)
  const measurement = useUiStore((s) => s.measurement)
  const tempTemplate = useUiStore((s) => s.tempTemplate)
  const prefs = useDevicePrefs()
  return useMemo(
    () =>
      campaign
        ? projectForPlayers(
            campaign,
            { liveDrag, dmCamera, dmViewport, measurement, tempTemplate },
            prefs,
          )
        : null,
    [campaign, liveDrag, dmCamera, dmViewport, measurement, tempTemplate, prefs],
  )
}
