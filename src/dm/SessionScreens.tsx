import {
  AlertTriangle,
  FolderOpen,
  LoaderCircle,
  MonitorSmartphone,
  Plus,
  Trash,
} from 'lucide-react'
import { useSessionStore } from '../store/session'
import { buttonClass, dangerButtonClass, primaryButtonClass } from '../ui/controls'
import { confirmAction } from './confirm'
import { deleteCampaign, newCampaign, openCampaign, takeOver } from './session'

const panelClass =
  'w-[min(30rem,calc(100vw-2rem))] space-y-4 rounded-xl border border-border bg-surface p-6 shadow-xl'

/** While the session waits for the DM lock and loads the campaign (shown after a short delay). */
export function StartingScreen() {
  return (
    <div className="flex h-full items-center justify-center bg-bg p-4 opacity-0 [animation:fade-in_0.2s_ease-out_0.4s_forwards]">
      <p role="status" className="flex items-center gap-2 text-sm text-fg-muted">
        <LoaderCircle aria-hidden className="size-4 animate-spin" />
        Opening your campaign…
      </p>
    </div>
  )
}

/** Another tab holds the DM lock (CLAUDE.md, "Single DM window"). */
export function InactiveScreen() {
  const reason = useSessionStore((s) => s.inactiveReason)
  return (
    <div className="flex h-full items-center justify-center bg-bg p-4">
      <section aria-labelledby="inactive-heading" className={panelClass}>
        <MonitorSmartphone aria-hidden className="size-6 text-accent" />
        <h1 id="inactive-heading" className="text-lg font-semibold">
          {reason === 'taken-over'
            ? 'The campaign is now open in another tab'
            : 'Combat Map is already open in another tab'}
        </h1>
        <p className="text-sm text-fg-muted">
          Only one DM window can edit at a time, so changes never overwrite each other. The other
          tab saves its changes before handing over.
        </p>
        <button type="button" className={primaryButtonClass} onClick={takeOver}>
          Use this tab instead
        </button>
      </section>
    </div>
  )
}

/** The last campaign could not be opened (damaged data, or saved by a newer app version). */
export function LoadFailedScreen() {
  const failure = useSessionStore((s) => s.failure)
  const campaigns = useSessionStore((s) => s.campaigns)
  const others = campaigns.filter((c) => c.id !== failure?.campaignId)
  const broken = campaigns.find((c) => c.id === failure?.campaignId)

  const askDelete = async () => {
    if (!broken) return
    const confirmed = await confirmAction({
      title: 'Delete campaign?',
      message: `“${broken.name}” will be deleted from this browser. This cannot be undone.`,
      confirmLabel: 'Delete campaign',
    })
    if (confirmed) await deleteCampaign(broken.id)
  }

  return (
    <div className="flex h-full items-center justify-center bg-bg p-4">
      <section aria-labelledby="failed-heading" className={panelClass}>
        <AlertTriangle aria-hidden className="size-6 text-danger" />
        <h1 id="failed-heading" className="text-lg font-semibold">
          {broken ? `“${broken.name}” could not be opened` : 'The campaign could not be opened'}
        </h1>
        <p className="text-sm break-words text-fg-muted">{failure?.message}</p>
        <p className="text-sm text-fg-muted">It stays stored in this browser, unchanged.</p>
        {others.length > 0 && (
          <ul className="space-y-1">
            {others.map((campaign) => (
              <li key={campaign.id}>
                <button
                  type="button"
                  className={`${buttonClass} w-full justify-start`}
                  onClick={() => void openCampaign(campaign.id)}
                >
                  <FolderOpen aria-hidden className="size-4" />
                  Open {campaign.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryButtonClass} onClick={() => void newCampaign()}>
            <Plus aria-hidden className="size-4" />
            New campaign
          </button>
          {broken && (
            <button type="button" className={dangerButtonClass} onClick={() => void askDelete()}>
              <Trash aria-hidden className="size-4" />
              Delete it
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
