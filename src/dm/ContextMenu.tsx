import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Pencil,
  Swords,
  Trash,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { findItem } from '../state/sceneOps'
import {
  deleteItems,
  duplicateItems,
  movableIds,
  reorderItems,
  toggleHidden,
  toggleLocked,
} from '../store/actions'
import { useActiveScene } from '../store/campaign'
import { addTokensToInitiative, tokensNotInInitiative } from '../store/initiativeActions'
import { useUiStore } from '../store/ui'
import type { Icon } from '../ui/controls'
import { MOD } from './shortcuts'

interface MenuEntry {
  label: string
  shortcut?: string
  icon: Icon
  disabled?: boolean
  danger?: boolean
  run: () => void
}

function close() {
  useUiStore.setState({ contextMenu: null })
}

/** Closing from the keyboard (or by choosing an entry) returns focus to the canvas. */
function closeAndRefocus() {
  close()
  document.getElementById('dm-canvas')?.focus({ preventScroll: true })
}

function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'),
  ]
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  let next: number | null = null
  if (event.key === 'ArrowDown') next = (index + 1) % buttons.length
  else if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = buttons.length - 1
  else if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault()
    closeAndRefocus()
    return
  }
  if (next !== null) {
    event.preventDefault()
    buttons[next]?.focus()
  }
}

/** Right-click menu on items (SPEC §5.3). Acts on the whole selection. */
export function ContextMenu() {
  const menu = useUiStore((s) => s.contextMenu)
  const selection = useUiStore((s) => s.selection)
  const scene = useActiveScene()
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  const refs = selection.flatMap((id) => findItem(scene, id) ?? [])
  const open = menu !== null && refs.length > 0

  // Keep the menu inside the window, then focus its first item.
  useLayoutEffect(() => {
    const element = ref.current
    if (!open || !menu || !element) {
      setPosition(null)
      return
    }
    const { width, height } = element.getBoundingClientRect()
    setPosition({
      left: Math.max(4, Math.min(menu.x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(menu.y, window.innerHeight - height - 4)),
    })
    element.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus()
  }, [open, menu])

  // Close on any press outside the menu.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close()
    }
    window.addEventListener('pointerdown', onPointerDown, { capture: true })
    return () => window.removeEventListener('pointerdown', onPointerDown, { capture: true })
  }, [open])

  if (!open) return null

  const ids = refs.map((r) => r.item.id)
  const items = refs.map((r) => r.item)
  const anyVisible = items.some((item) => !item.hidden)
  const anyUnlocked = items.some((item) => !item.locked)
  const canDelete = movableIds(ids).length > 0
  const tokenSelected = refs.some((r) => r.layer === 'tokens')
  const entries: MenuEntry[] = [
    {
      label: anyVisible ? 'Hide from players' : 'Show to players',
      shortcut: 'H',
      icon: anyVisible ? EyeOff : Eye,
      run: () => toggleHidden(ids),
    },
    {
      label: anyUnlocked ? 'Lock' : 'Unlock',
      shortcut: 'L',
      icon: anyUnlocked ? Lock : LockOpen,
      run: () => toggleLocked(ids),
    },
    ...(tokenSelected
      ? [
          {
            label: 'Add to initiative',
            icon: Swords,
            disabled: tokensNotInInitiative(scene, ids).length === 0,
            run: () => {
              addTokensToInitiative(ids)
            },
          },
        ]
      : []),
    { label: 'Duplicate', shortcut: `${MOD}+D`, icon: Copy, run: () => duplicateItems(ids) },
    { label: 'Bring forward', icon: ArrowUp, run: () => reorderItems(ids, 'forward') },
    { label: 'Send backward', icon: ArrowDown, run: () => reorderItems(ids, 'backward') },
    ...(tokenSelected && refs.length === 1
      ? [
          {
            label: 'Edit token',
            icon: Pencil,
            run: () =>
              useUiStore.setState((s) => ({
                propertiesFocusRequest: s.propertiesFocusRequest + 1,
              })),
          },
        ]
      : []),
    {
      label: 'Delete',
      shortcut: 'Del',
      icon: Trash,
      danger: true,
      disabled: !canDelete,
      run: () => deleteItems(ids),
    },
  ]

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-label={
        refs.length === 1
          ? `Actions for ${refs[0]?.item.name ?? 'item'}`
          : `Actions for ${refs.length} items`
      }
      onKeyDown={onMenuKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      className="fixed z-50 min-w-52 rounded-lg border border-border bg-surface p-1 shadow-xl"
      style={{
        left: position?.left ?? menu.x,
        top: position?.top ?? menu.y,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {entries.map((entry) => (
        <button
          key={entry.label}
          type="button"
          role="menuitem"
          disabled={entry.disabled}
          onClick={() => {
            closeAndRefocus()
            entry.run()
          }}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-3 focus-visible:bg-surface-3 disabled:opacity-40 disabled:hover:bg-transparent ${entry.danger ? 'text-danger' : ''}`}
        >
          <entry.icon aria-hidden className="size-4" />
          <span className="flex-1">{entry.label}</span>
          {entry.shortcut && (
            <kbd className="font-sans text-xs text-fg-muted">{entry.shortcut}</kbd>
          )}
        </button>
      ))}
    </div>
  )
}
