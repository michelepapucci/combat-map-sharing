import {
  forwardRef,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from 'react'

/** Shared form and button primitives for the DM panels. */

export type Icon = ComponentType<SVGProps<SVGSVGElement>>

export const inputClass =
  'w-full min-w-0 rounded-md border border-border bg-surface-2 px-2 py-1 text-sm text-fg placeholder:text-fg-muted disabled:opacity-50'

export const buttonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1 text-sm text-fg hover:bg-surface-3 disabled:opacity-50 disabled:hover:bg-surface-2'

export const primaryButtonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:brightness-110 disabled:opacity-50'

export const dangerButtonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-danger/60 px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50'

export function Field({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-fg-muted ${className ?? ''}`}>
      <span>{label}</span>
      {children}
    </label>
  )
}

export function IconButton({
  icon: IconComponent,
  label,
  title,
  onClick,
  pressed,
  disabled,
  className,
}: {
  icon: Icon
  label: string
  /** Tooltip; defaults to the label. Include the shortcut when there is one. */
  title?: string
  onClick: () => void
  pressed?: boolean
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
      className={`rounded-md p-1.5 text-fg-muted hover:bg-surface-3 hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent aria-pressed:bg-surface-3 aria-pressed:text-accent ${className ?? ''}`}
    >
      <IconComponent aria-hidden className="size-4" />
    </button>
  )
}

interface CommitTextInputProps {
  value: string
  onCommit: (value: string) => void
  maxLength?: number
  placeholder?: string
  'aria-label'?: string
  id?: string
}

/**
 * A text input that edits a local draft and commits on Enter or blur (one undo
 * step per edit); Escape reverts. Remount it (key) when the edited object changes.
 */
export const CommitTextInput = forwardRef<HTMLInputElement, CommitTextInputProps>(
  function CommitTextInput({ value, onCommit, ...rest }, ref) {
    const [draft, setDraft] = useState(value)
    const [lastValue, setLastValue] = useState(value)
    // Escape blurs synchronously inside keydown, before the reverted draft renders,
    // so the blur handler must be told not to commit.
    const cancelled = useRef(false)
    if (value !== lastValue) {
      setLastValue(value)
      setDraft(value)
    }
    return (
      <input
        ref={ref}
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (!cancelled.current && draft !== value) {
            onCommit(draft)
            // Show the stored value again if the edit was refused (an empty name):
            // an accepted one changes `value` and resyncs the draft anyway.
            setDraft(value)
          }
          cancelled.current = false
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            event.preventDefault()
            cancelled.current = true
            setDraft(value)
            event.currentTarget.blur()
          }
        }}
        className={inputClass}
        {...rest}
      />
    )
  },
)

/** A multi-line text area committed on blur (Ctrl/⌘+Enter also commits); Escape reverts. */
export function CommitTextarea({
  value,
  onCommit,
  maxLength,
  rows = 3,
  placeholder,
  'aria-label': ariaLabel,
}: {
  value: string
  onCommit: (value: string) => void
  maxLength?: number
  rows?: number
  placeholder?: string
  'aria-label'?: string
}) {
  const [draft, setDraft] = useState(value)
  const [lastValue, setLastValue] = useState(value)
  const cancelled = useRef(false)
  if (value !== lastValue) {
    setLastValue(value)
    setDraft(value)
  }
  return (
    <textarea
      value={draft}
      rows={rows}
      maxLength={maxLength}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (!cancelled.current && draft !== value) onCommit(draft)
        cancelled.current = false
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) event.currentTarget.blur()
        if (event.key === 'Escape') {
          event.preventDefault()
          cancelled.current = true
          setDraft(value)
          event.currentTarget.blur()
        }
      }}
      className={`${inputClass} resize-y`}
    />
  )
}

/**
 * A number input committed on Enter or blur; invalid input reverts. With
 * `onClear`, the value may be unset: null shows as empty, and clearing the
 * field calls onClear.
 */
export function CommitNumberInput({
  value,
  onCommit,
  onClear,
  min,
  max,
  step,
  placeholder,
  'aria-label': ariaLabel,
}: {
  value: number | null
  onCommit: (value: number) => void
  onClear?: () => void
  min?: number
  max?: number
  step?: number
  placeholder?: string
  'aria-label'?: string
}) {
  const shown = value === null ? '' : String(Math.round(value * 100) / 100)
  const [draft, setDraft] = useState(shown)
  const [lastShown, setLastShown] = useState(shown)
  const cancelled = useRef(false)
  if (shown !== lastShown) {
    setLastShown(shown)
    setDraft(shown)
  }
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    // Unchanged text: the display is rounded, so committing it would alter the value.
    if (draft === shown) return
    const parsed = Number(draft)
    if (draft.trim() === '' && onClear && value !== null) {
      onClear()
      return
    }
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(shown)
      return
    }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed))
    if (clamped !== value) onCommit(clamped)
    else setDraft(shown)
  }
  return (
    <input
      type="number"
      value={draft}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
        if (event.key === 'Escape') {
          event.preventDefault()
          cancelled.current = true
          setDraft(shown)
          event.currentTarget.blur()
        }
      }}
      className={inputClass}
    />
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  icon: IconComponent,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  icon?: Icon
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-[var(--accent)]"
      />
      {IconComponent && <IconComponent aria-hidden className="size-4 text-fg-muted" />}
      <span>{label}</span>
    </label>
  )
}

export function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-xs font-semibold tracking-wider text-fg-muted uppercase">
      {children}
    </h2>
  )
}

/** A heading inside a panel (the panel's own title is an h2). */
export function SubsectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 id={id} className="text-xs font-semibold tracking-wider text-fg-muted uppercase">
      {children}
    </h3>
  )
}
