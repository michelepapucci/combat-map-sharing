import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useUiStore } from '../store/ui'
import { SHORTCUT_GROUPS } from './shortcuts'

/** Keyboard cheat sheet (SPEC §5.3, opened with ?). A native modal dialog: Esc closes it. */
export function ShortcutsDialog() {
  const open = useUiStore((s) => s.shortcutsOpen)
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby="shortcuts-heading"
      onClose={() => useUiStore.setState({ shortcutsOpen: false })}
      className="m-auto max-h-[85vh] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-surface p-0 text-fg shadow-2xl backdrop:bg-bg/70"
    >
      <div className="space-y-4 p-5">
        <div className="flex items-center">
          <h2 id="shortcuts-heading" className="text-lg font-semibold">
            Keyboard and mouse
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
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className="space-y-1.5">
            <h3 className="text-xs font-semibold tracking-wider text-fg-muted uppercase">
              {group.title}
            </h3>
            <table className="w-full text-sm">
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.action} className="border-t border-border first:border-t-0">
                    <td className="py-1 pr-4 align-top whitespace-nowrap">
                      {row.keys.map((key, i) => (
                        <span key={key}>
                          {i > 0 && <span className="text-fg-muted"> / </span>}
                          <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-sans text-xs">
                            {key}
                          </kbd>
                        </span>
                      ))}
                    </td>
                    <td className="py-1">{row.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </dialog>
  )
}
