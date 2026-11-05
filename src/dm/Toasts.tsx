import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { useEffect } from 'react'
import { dismissToast, useUiStore, type Toast, type ToastKind } from '../store/ui'

/** How long a non-sticky toast stays (ms). */
const FADE_MS = 4500

const ICONS: Record<ToastKind, typeof Info> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
}

const TONES: Record<ToastKind, string> = {
  info: 'border-l-fg-muted',
  success: 'border-l-ok',
  warning: 'border-l-accent',
  error: 'border-l-danger',
}

const ICON_TONES: Record<ToastKind, string> = {
  info: 'text-fg-muted',
  success: 'text-ok',
  warning: 'text-accent',
  error: 'text-danger',
}

const box =
  'pointer-events-auto flex max-w-[min(36rem,calc(100vw-4rem))] items-start gap-2 rounded-lg border border-border border-l-4 bg-surface px-3 py-2 text-sm shadow-lg'

function ToastItem({ toast }: { toast: Toast }) {
  const Icon = ICONS[toast.kind]
  // Non-sticky toasts fade; a repeat (new `at`) restarts the clock.
  useEffect(() => {
    if (toast.sticky) return
    const timer = setTimeout(
      () => dismissToast(toast.id),
      Math.max(0, toast.at + FADE_MS - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [toast.id, toast.sticky, toast.at])
  return (
    // Errors interrupt; everything else is read politely by the region around it.
    <div
      role={toast.kind === 'error' ? 'alert' : undefined}
      className={`${box} ${TONES[toast.kind]}`}
    >
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${ICON_TONES[toast.kind]}`} />
      <div className="space-y-1">
        {toast.lines.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
      {toast.count > 1 && (
        <span className="shrink-0 rounded-full bg-surface-3 px-1.5 text-xs text-fg-muted">
          ×{toast.count}
        </span>
      )}
      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        aria-label="Dismiss message"
        title="Dismiss"
        className="-my-0.5 -mr-1 shrink-0 rounded-md p-1 text-fg-muted hover:bg-surface-3 hover:text-fg"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  )
}

/**
 * Toasts (SPEC §8): saves, imports, errors, player window connected or
 * disconnected. Stacked at the bottom of the map, newest last; warnings and
 * errors stay until dismissed. The import progress shows above them.
 */
export function Toasts() {
  const toasts = useUiStore((s) => s.toasts)
  const progress = useUiStore((s) => s.importProgress)
  return (
    // A live region that is always in the page, so screen readers announce
    // each toast added to it (a region inserted with its text often is not).
    <section
      aria-label="Notifications"
      aria-live="polite"
      className="pointer-events-none absolute bottom-16 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {progress && (
        <p className={`${box} border-l-fg-muted`}>
          <LoaderCircle aria-hidden className="size-4 animate-spin text-fg-muted" />
          Importing image {Math.min(progress.done + 1, progress.total)} of {progress.total}…
        </p>
      )}
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </section>
  )
}
