import { CloudFog, Eraser, RotateCcw } from 'lucide-react'
import { confirmAction } from '../dm/confirm'
import { useActiveScene } from '../store/campaign'
import { clearFogEdits, resetExplored, setSceneFog } from '../store/fogActions'
import { setTool } from '../store/ui'
import { buttonClass, SubsectionHeading, Toggle } from '../ui/controls'

async function askResetExplored(): Promise<void> {
  const confirmed = await confirmAction({
    title: 'Reset explored areas?',
    message:
      'Players forget everything they have explored on this scene: it goes back to black, ' +
      'except what their tokens see now. This cannot be undone.',
    confirmLabel: 'Reset explored areas',
  })
  if (confirmed) resetExplored()
}

/** The active scene's fog of war (SPEC §5.6): on/off, explored memory, manual edits. */
export function FogSettings() {
  const scene = useActiveScene()
  const { fog } = scene
  const edits = fog.manual.length
  return (
    <section aria-labelledby="fog-heading" className="space-y-2">
      <SubsectionHeading id="fog-heading">Fog of war</SubsectionHeading>
      <Toggle
        checked={fog.enabled}
        onChange={(enabled) => setSceneFog({ enabled })}
        label="Fog of war on this scene"
      />
      <Toggle
        checked={fog.exploredEnabled}
        onChange={(exploredEnabled) => setSceneFog({ exploredEnabled })}
        label="Remember explored areas (dimmed for players)"
      />
      <p className="text-xs text-fg-muted">
        Players see what their tokens see (their vision radius). Move tokens during blackout to keep
        it out of explored memory.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className={buttonClass}
          onClick={() => setTool('fog')}
          title="Reveal or hide areas by hand (F)"
        >
          <CloudFog aria-hidden className="size-4" />
          Fog tool
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={clearFogEdits}
          disabled={edits === 0}
          title="Remove every manual reveal and hide on this scene (undoable)"
        >
          <Eraser aria-hidden className="size-4" />
          {edits === 0 ? 'No manual fog' : `Clear manual fog (${edits})`}
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => void askResetExplored()}
          title="Forget what players have explored on this scene"
        >
          <RotateCcw aria-hidden className="size-4" />
          Reset explored…
        </button>
      </div>
    </section>
  )
}
