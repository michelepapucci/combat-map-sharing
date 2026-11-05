import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Icon } from './controls'

export interface MenuItem {
  label: string
  icon: Icon
  disabled?: boolean
  /** Tooltip, e.g. why the item is disabled. */
  hint?: string
  danger?: boolean
  run: () => void
}

/**
 * A dropdown menu (role="menu") opened from a button: positioned below the
 * anchor and kept inside the window, first item focused, arrows/Home/End move,
 * Esc or Tab closes, a press outside closes. Choosing an item closes it first.
 */
export function Menu({
  anchor,
  label,
  items,
  onClose,
}: {
  /** The opening button. Presses on it are left to it (so it can toggle the menu closed). */
  anchor: HTMLElement
  label: string
  items: readonly MenuItem[]
  /** `refocus` is true when the anchor button should get focus back (keyboard close, choice). */
  onClose: (refocus: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const { width, height } = element.getBoundingClientRect()
    const rect = anchor.getBoundingClientRect()
    setPosition({
      left: Math.max(4, Math.min(rect.left, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(rect.bottom + 4, window.innerHeight - height - 4)),
    })
    element.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus()
  }, [anchor])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!ref.current?.contains(target) && !anchor.contains(target)) onClose(false)
    }
    window.addEventListener('pointerdown', onPointerDown, { capture: true })
    return () => window.removeEventListener('pointerdown', onPointerDown, { capture: true })
  }, [onClose, anchor])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled])',
      ),
    ]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let next: number | null = null
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length
    else if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = buttons.length - 1
    else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      onClose(true)
      return
    }
    if (next !== null) {
      event.preventDefault()
      buttons[next]?.focus()
    }
  }

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-label={label}
      onKeyDown={onKeyDown}
      className="fixed z-50 min-w-48 rounded-lg border border-border bg-surface p-1 shadow-xl"
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          title={item.hint}
          onClick={() => {
            onClose(true)
            item.run()
          }}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-3 focus-visible:bg-surface-3 disabled:opacity-40 disabled:hover:bg-transparent ${item.danger ? 'text-danger' : ''}`}
        >
          <item.icon aria-hidden className="size-4" />
          <span className="flex-1">{item.label}</span>
        </button>
      ))}
    </div>
  )
}
