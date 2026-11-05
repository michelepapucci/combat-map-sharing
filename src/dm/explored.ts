import { visionSources, type VisionSource } from '../geometry/fog'
import { rasterizeReveals, recordVision, type ManualEdits } from '../geometry/fogRaster'
import type { FogMask, Id } from '../state/types'
import { setUnrecorded, useCampaignStore } from '../store/campaign'

/**
 * Explored memory (SPEC §5.6, CLAUDE.md "Fog"): what players have seen stays
 * revealed, dimmed. It grows with every committed change to what their tokens
 * see, while players can see the scene (fog and explored memory on, no
 * blackout): a moved token adds the corridor swept from its old position to
 * its new one, anything else (placement, unhide, more vision, NPC vision) adds
 * the new circles; manual reveals are recorded too. Ground under a manual hide
 * is never recorded (players could not see it). Vision follows committed
 * positions, so a drag in progress reveals nothing until the drop. Never undone
 * (sceneMemory is outside history).
 * Runs in the DM tab that holds the lock (started with the presentation).
 */

/** Vision sources at the last check, per scene, to turn moves into swept corridors. */
const lastSources = new Map<Id, ReadonlyMap<Id, VisionSource>>()
let lastCheck: {
  sceneId: Id
  sources: string
  recording: boolean
  explored: FogMask | null
  manual: ManualEdits
} | null = null

export function recordExplored(): void {
  const { campaign } = useCampaignStore.getState()
  if (!campaign) return
  const scene = campaign.scenes.find((s) => s.id === campaign.activeSceneId)
  if (!scene) return
  const memory = campaign.sceneMemory[scene.id]
  const sources = visionSources(scene, campaign.settings)
  const recording =
    scene.fog.enabled && scene.fog.exploredEnabled && !campaign.presentation.blackout && !!memory
  const signature = JSON.stringify(sources)
  const explored = memory?.explored ?? null
  const manual = scene.fog.manual
  // Nothing that affects explored memory changed (most edits: names, HP, props...).
  if (
    lastCheck?.sceneId === scene.id &&
    lastCheck.sources === signature &&
    lastCheck.recording === recording &&
    lastCheck.explored === explored &&
    lastCheck.manual === manual
  ) {
    return
  }
  // Record everything players see now, not only what changed, when recording
  // (re)starts, in another scene, after the mask was replaced (reset) or when
  // the manual edits changed (a cleared hide uncovers what vision reaches).
  const all =
    lastCheck?.sceneId !== scene.id ||
    !lastCheck.recording ||
    lastCheck.explored !== explored ||
    lastCheck.manual !== manual
  lastCheck = { sceneId: scene.id, sources: signature, recording, explored, manual }
  const previous = lastSources.get(scene.id) ?? new Map<Id, VisionSource>()
  // Remember positions even when not recording: lifting blackout records circles, not corridors.
  lastSources.set(scene.id, new Map(sources.map((source) => [source.tokenId, source])))
  if (!recording || !explored) return
  const seen = recordVision(explored, previous, sources, { manual, all })
  const next = all ? (rasterizeReveals(seen ?? explored, manual) ?? seen) : seen
  if (!next) return
  // Immer keeps the assigned object, so the change notification this write
  // triggers finds nothing new and does not rasterize again.
  lastCheck.explored = next
  setUnrecorded((draft) => {
    const target = draft.sceneMemory[scene.id]
    if (target) target.explored = next
  })
}

/** Forgets remembered positions (another campaign opened). */
export function resetExploredTracking(): void {
  lastSources.clear()
  lastCheck = null
}
