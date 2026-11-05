import { useMemo } from 'react'
import { Layer, Rect } from 'react-konva'
import { FogLayer } from '../../canvas/FogLayer'
import { PlayerSceneLayers } from '../../canvas/PlayerSceneLayers'
import { visionSources } from '../../geometry/fog'
import type { Rect as RectShape } from '../../geometry/types'
import { projectForPlayers } from '../../projection/projectForPlayers'
import { useActiveScene, useCampaign, useCampaignStore } from '../../store/campaign'
import { useDevicePrefs } from '../../store/devicePrefs'
import { useUiStore } from '../../store/ui'

/**
 * The fog as the DM sees it (SPEC §5.6): the same regions players get, as a
 * light tint, so the DM still sees everything. Vision uses committed positions.
 */
export function DmFogTint({ cover }: { cover: RectShape }) {
  const scene = useActiveScene()
  const npcVision = useCampaign((c) => c.settings.npcVision)
  const memory = useCampaign((c) => c.sceneMemory[c.activeSceneId])
  const fog = useMemo(
    () => ({
      visible: visionSources(scene, { npcVision }),
      explored: scene.fog.exploredEnabled ? (memory?.explored ?? null) : null,
      manual: scene.fog.manual,
    }),
    [scene, npcVision, memory],
  )
  if (!scene.fog.enabled) return null
  return <FogLayer cover={cover} fog={fog} mode="dm" />
}

/**
 * "Preview as players" (SPEC §5.6): projectForPlayers rendered through the
 * player renderer inside the DM window, at the DM's camera, so it matches the
 * TV by construction. The players' frame is outlined.
 */
export function PlayersPreview({ cover, scale }: { cover: RectShape; scale: number }) {
  const campaign = useCampaignStore((s) => s.campaign)
  const liveDrag = useUiStore((s) => s.liveDrag)
  const dmCamera = useUiStore((s) => s.dmCamera)
  const dmViewport = useUiStore((s) => s.dmViewport)
  const measurement = useUiStore((s) => s.measurement)
  const tempTemplate = useUiStore((s) => s.tempTemplate)
  const pings = useUiStore((s) => s.pings)
  const prefs = useDevicePrefs()
  const view = useMemo(
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
  if (!view) return null
  if (view.blackout) {
    return (
      <Layer listening={false}>
        <Rect {...cover} fill="#000000" />
      </Layer>
    )
  }
  const { view: frame } = view.scene
  return (
    <>
      <Layer listening={false}>
        <Rect {...cover} fill="#000000" />
      </Layer>
      <PlayerSceneLayers
        scene={view.scene}
        cover={cover}
        scale={scale}
        pings={pings.map((p) => ({ id: p.id, x: p.x, y: p.y, startedAt: p.createdAt }))}
        clipToView={false}
      />
      <Layer listening={false}>
        <Rect {...frame} stroke="#ffd166" strokeWidth={2 / scale} dash={[10 / scale, 6 / scale]} />
      </Layer>
    </>
  )
}
