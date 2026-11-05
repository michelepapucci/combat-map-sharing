import { buttonClass, dangerButtonClass, primaryButtonClass } from '../ui/controls'
import { Dialog } from '../ui/Dialog'
import { settle, useConfirmStore } from './confirm'

/** The confirmation dialog for confirmAction (rendered once by DmApp). */
export function ConfirmDialog() {
  const request = useConfirmStore((s) => s.request)
  if (!request) return null
  return (
    <Dialog
      key={request.title + request.message}
      title={request.title}
      onClose={() => settle(false)}
      footer={
        <>
          <button type="button" className={buttonClass} onClick={() => settle(false)}>
            Cancel
          </button>
          <button
            type="button"
            className={request.danger ? dangerButtonClass : primaryButtonClass}
            onClick={() => settle(true)}
          >
            {request.confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm whitespace-pre-line">{request.message}</p>
    </Dialog>
  )
}
