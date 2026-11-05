import { buttonClass, dangerButtonClass, primaryButtonClass } from '../ui/controls'
import { Dialog } from '../ui/Dialog'
import { settle, useConfirmStore, type Choice } from './confirm'

const TONES: Record<Choice['tone'], string> = {
  primary: primaryButtonClass,
  danger: dangerButtonClass,
  plain: buttonClass,
}

/** The dialog for confirmAction and chooseAction (rendered once by DmApp). */
export function ConfirmDialog() {
  const request = useConfirmStore((s) => s.request)
  if (!request) return null
  return (
    <Dialog
      key={request.title + request.message}
      title={request.title}
      onClose={() => settle(null)}
      footer={
        <>
          <button type="button" className={buttonClass} onClick={() => settle(null)}>
            Cancel
          </button>
          {request.choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              className={TONES[choice.tone]}
              onClick={() => settle(choice.id)}
            >
              {choice.label}
            </button>
          ))}
        </>
      }
    >
      <p className="text-sm whitespace-pre-line">{request.message}</p>
    </Dialog>
  )
}
