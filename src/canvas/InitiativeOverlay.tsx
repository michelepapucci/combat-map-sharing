import { useLayoutEffect, useRef } from 'react'
import type { PlayerInitiative } from '../state/types'
import { ACTIVE_TURN_COLOR } from './ActiveTurnRing'
import { hpColor } from './color'

/**
 * The players' initiative tracker (SPEC §5.8, §5.9): a corner overlay with the
 * round and the names in turn order, the current turn highlighted, and a health
 * bar only for public HP. It shows exactly what the projection sends: hidden
 * entries are simply absent, and values are never sent. Sized for a TV (it
 * follows the window height). HTML, not Konva, so text stays sharp. Used by
 * the player window and by "Preview as players"; props only.
 */
export function InitiativeOverlay({ initiative }: { initiative: PlayerInitiative }) {
  const listRef = useRef<HTMLOListElement>(null)
  const activeId = initiative.entries.find((entry) => entry.active)?.id ?? null
  // A long list is cut at the bottom of the screen: when the turn changes, scroll
  // the list (only the list: the round stays put) so the current turn is in view.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || activeId === null) return
    const item = list.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(activeId)}"]`)
    if (!item) return
    const top = item.offsetTop
    const bottom = top + item.offsetHeight
    if (top < list.scrollTop) list.scrollTop = top
    else if (bottom > list.scrollTop + list.clientHeight)
      list.scrollTop = bottom - list.clientHeight
  }, [activeId])
  if (initiative.entries.length === 0) return null
  return (
    <aside
      aria-label="Initiative"
      className="pointer-events-none absolute top-3 left-3 flex max-h-[calc(100%-1.5rem)] max-w-[40%] flex-col rounded-xl bg-black/75 px-[0.9em] py-[0.6em] text-neutral-100 shadow-lg"
      style={{ fontSize: 'clamp(14px, 2.6vh, 32px)' }}
    >
      <p className="text-[0.65em] font-semibold tracking-widest text-neutral-400 uppercase">
        Round {initiative.round}
      </p>
      <ol ref={listRef} className="relative mt-[0.3em] min-h-0 space-y-[0.25em] overflow-hidden">
        {initiative.entries.map((entry) => (
          <li
            key={entry.id}
            data-entry-id={entry.id}
            aria-current={entry.active ? 'step' : undefined}
            className="leading-tight"
            style={entry.active ? { color: ACTIVE_TURN_COLOR, fontWeight: 700 } : undefined}
          >
            <span className="flex items-center gap-[0.4em]">
              <span aria-hidden className="w-[0.7em] shrink-0 text-[0.8em]">
                {entry.active ? '▶' : ''}
              </span>
              <span className="truncate">{entry.name}</span>
            </span>
            {entry.hpFraction !== null && (
              <span
                aria-hidden
                className="mt-[0.15em] ml-[1.1em] block h-[0.18em] w-[5em] overflow-hidden rounded-full bg-neutral-800"
              >
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.round(Math.min(1, Math.max(0, entry.hpFraction)) * 100)}%`,
                    background: hpColor(entry.hpFraction),
                  }}
                />
              </span>
            )}
          </li>
        ))}
      </ol>
    </aside>
  )
}
