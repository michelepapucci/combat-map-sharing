import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

/**
 * A native modal dialog (focus trap, Esc to close, inert background) with a
 * title bar. Rendered only while open; `onClose` runs on Esc, the close button,
 * or `close()` from inside.
 */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  width = 'w-[min(32rem,calc(100vw-2rem))]',
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className={`m-auto max-h-[85vh] overflow-hidden rounded-xl border border-border bg-surface p-0 text-fg shadow-2xl backdrop:bg-bg/70 ${width}`}
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="ml-auto rounded-md p-1.5 text-fg-muted hover:bg-surface-3 hover:text-fg"
            aria-label="Close"
            title="Close (Esc)"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </dialog>
  )
}
