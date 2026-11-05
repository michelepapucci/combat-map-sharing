import { Copy, FolderOpen, Plus, Trash } from 'lucide-react'
import { useEffect } from 'react'
import { useCampaign } from '../store/campaign'
import { useSessionStore } from '../store/session'
import { useUiStore } from '../store/ui'
import { buttonClass, CommitTextInput, Field, primaryButtonClass } from '../ui/controls'
import { Dialog } from '../ui/Dialog'
import { confirmAction } from './confirm'
import {
  deleteCampaign,
  duplicateCampaign,
  newCampaign,
  openCampaign,
  refreshCampaigns,
  renameCampaign,
} from './session'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function close() {
  useUiStore.setState({ dialog: null })
}

async function askDelete(id: string, name: string): Promise<void> {
  const confirmed = await confirmAction({
    title: 'Delete campaign?',
    message: `“${name}” and all its scenes will be deleted from this browser. This cannot be undone.`,
    confirmLabel: 'Delete campaign',
  })
  if (confirmed) await deleteCampaign(id)
}

/** Local campaigns (SPEC §6, CLAUDE.md "Persistence"): rename, new, open, duplicate, delete. */
export function CampaignsDialog() {
  const currentId = useCampaign((c) => c.id)
  const currentName = useCampaign((c) => c.name)
  const campaigns = useSessionStore((s) => s.campaigns)
  const unavailable = useSessionStore((s) => s.storageUnavailable)

  useEffect(() => {
    void refreshCampaigns()
  }, [])

  return (
    <Dialog title="Campaigns" onClose={close} width="w-[min(38rem,calc(100vw-2rem))]">
      <div className="space-y-5">
        <Field label="Name of this campaign">
          <CommitTextInput
            key={currentId}
            value={currentName}
            maxLength={200}
            onCommit={renameCampaign}
          />
        </Field>
        <section aria-labelledby="campaign-list-heading" className="space-y-2">
          <div className="flex items-center">
            <h3 id="campaign-list-heading" className="text-sm font-medium">
              Campaigns in this browser
            </h3>
            <button
              type="button"
              className={`${primaryButtonClass} ml-auto`}
              onClick={() => {
                close()
                void newCampaign()
              }}
            >
              <Plus aria-hidden className="size-4" />
              New campaign
            </button>
          </div>
          {unavailable ? (
            <p className="text-sm text-danger">
              This browser does not allow saving, so only the open campaign exists.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {campaigns.map((campaign) => {
                const open = campaign.id === currentId
                const name = open ? currentName : campaign.name
                return (
                  <li key={campaign.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {name}
                        {open && <span className="ml-2 text-xs text-accent">open</span>}
                      </p>
                      <p className="text-xs text-fg-muted">
                        {campaign.scenes === 1 ? '1 scene' : `${campaign.scenes} scenes`}
                        {campaign.updatedAt > 0 &&
                          ` · saved ${dateFormat.format(campaign.updatedAt)}`}
                      </p>
                    </div>
                    {!open && (
                      <button
                        type="button"
                        className={buttonClass}
                        onClick={() => {
                          close()
                          void openCampaign(campaign.id)
                        }}
                        aria-label={`Open ${name}`}
                      >
                        <FolderOpen aria-hidden className="size-4" />
                        Open
                      </button>
                    )}
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() => void duplicateCampaign(campaign.id)}
                      aria-label={`Duplicate ${name}`}
                      title="Duplicate"
                    >
                      <Copy aria-hidden className="size-4" />
                    </button>
                    <button
                      type="button"
                      className={`${buttonClass} text-danger`}
                      onClick={() => void askDelete(campaign.id, name)}
                      aria-label={`Delete ${name}`}
                      title="Delete"
                    >
                      <Trash aria-hidden className="size-4" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="text-xs text-fg-muted">
            Campaigns and uploaded images are saved in this browser only. Clearing site data deletes
            them.
          </p>
        </section>
      </div>
    </Dialog>
  )
}
