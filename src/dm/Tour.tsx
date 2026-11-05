import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useUiStore } from '../store/ui'
import { buttonClass, primaryButtonClass } from '../ui/controls'
import { closeTour } from './tour'

interface Step {
  /** CSS selector of the element to point at. */
  target: string
  title: string
  text: string
}

/** The four steps (SPEC §8 "a 4-step hint overlay"). */
const STEPS: readonly Step[] = [
  {
    target: '[data-testid="dm-canvas"]',
    title: 'The map',
    text: 'Pick a default map, or drop your own image on the map. If the image has a grid drawn on it, line ours up with it from the Scene panel (Calibrate). Scroll to zoom; drag with the right or middle button to pan.',
  },
  {
    target: '[data-panel="library"]',
    title: 'Tokens and props',
    text: 'Click one to place it in the middle of the view, or drag it onto the map. Select a token to set its label, vision, hit points and conditions in Properties. Upload your own images here too.',
  },
  {
    target: '[data-tour="player-window"]',
    title: 'The players’ screen',
    text: 'Open the player window and move it to the TV or projector (F11 for full screen). It shows only what players may see: hidden tokens, DM notes and hit points never reach it.',
  },
  {
    target: '[role="toolbar"][aria-label="Tools"]',
    title: 'At the table',
    text: 'Fog of war (F), ruler (M), areas of effect (A) and pings (P) are here; initiative and blackout are in the panels. Press ? for every shortcut. Campaigns save in this browser; back them up or sync them to a GitHub Gist.',
  },
]

const CARD_WIDTH = 340
const GAP = 14

interface Box {
  x: number
  y: number
  width: number
  height: number
}

function rectOf(selector: string): Box | null {
  const element = document.querySelector(selector)
  if (!element) return null
  const r = element.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null
}

/** Where the card goes: beside the target where there is room, inside the window. */
function placeCard(target: Box | null, height: number): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  // The title and Skip stay on screen even when the window is shorter than the card.
  const clampTop = (top: number) => Math.max(Math.min(top, vh - height - 8), 8)
  const clampLeft = (left: number) => Math.max(Math.min(left, vw - CARD_WIDTH - 8), 8)
  if (!target) return { left: clampLeft((vw - CARD_WIDTH) / 2), top: clampTop((vh - height) / 2) }
  // A large target (the map): the card sits inside it, near its top-left corner.
  if (target.width > vw * 0.5)
    return { left: clampLeft(target.x + 24), top: clampTop(target.y + 24) }
  if (target.x + target.width + GAP + CARD_WIDTH <= vw) {
    return { left: target.x + target.width + GAP, top: clampTop(target.y) }
  }
  if (target.x - GAP - CARD_WIDTH >= 0) {
    return { left: target.x - GAP - CARD_WIDTH, top: clampTop(target.y) }
  }
  return { left: clampLeft(target.x), top: clampTop(target.y + target.height + GAP) }
}

/**
 * The getting-started tour: a dimmed screen with the step's target cut out,
 * and a card to read it, go back, go on, or skip. Clicks pass through the dim
 * area. Shown once per device (see tour.ts).
 */
export function Tour() {
  const open = useUiStore((s) => s.tourOpen)
  // Mounted only while open, so it always starts again at the first step.
  return open ? <TourSteps /> : null
}

function TourSteps() {
  const [index, setIndex] = useState(0)
  const [target, setTarget] = useState<Box | null>(null)
  const [cardHeight, setCardHeight] = useState(200)
  const card = useRef<HTMLDivElement>(null)
  const next = useRef<HTMLButtonElement>(null)
  const step = STEPS[index] ?? STEPS[0]

  // Bring the target into view (the sidebar may be scrolled), then follow it
  // as the window resizes or the sidebar scrolls.
  useEffect(() => {
    if (!step) return
    document.querySelector(step.target)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const measure = () => setTarget(rectOf(step.target))
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    const timer = setInterval(measure, 500)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      clearInterval(timer)
    }
  }, [step])

  // The card's height (it changes with each step's text) places it within the window.
  useEffect(() => {
    const node = card.current
    if (!node) return
    const observer = new ResizeObserver(() => setCardHeight(node.offsetHeight))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // Focus moves to the card, and back to where it was when the tour closes.
  useEffect(() => {
    const node = card.current
    const previous = document.activeElement
    node?.focus()
    return () => {
      const active = document.activeElement
      const lost = !active || active === document.body || !!node?.contains(active)
      if (lost && previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])

  // Esc skips the tour only when nothing else has focus: a dialog, a menu, a
  // field being edited or the canvas keep their own Esc.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const active = document.activeElement
      const inCard = !!active && !!card.current?.contains(active)
      const idle = !active || active === document.body
      if (!inCard && !idle) return
      if (document.querySelector('dialog[open], [role="menu"]')) return
      event.preventDefault()
      event.stopImmediatePropagation()
      closeTour()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [])

  if (!step) return null
  const last = index === STEPS.length - 1
  const back = () => {
    setIndex(index - 1)
    // Back is disabled on the first step: keep keyboard focus in the card.
    if (index - 1 === 0) next.current?.focus()
  }
  const position = placeCard(target, cardHeight)
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed z-40 rounded-lg ring-2 ring-accent transition-all duration-200"
        style={
          target
            ? {
                left: target.x - 4,
                top: target.y - 4,
                width: target.width + 8,
                height: target.height + 8,
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
              }
            : { inset: 0, boxShadow: 'inset 0 0 0 9999px rgba(0, 0, 0, 0.55)' }
        }
      />
      <div
        ref={card}
        role="dialog"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
        tabIndex={-1}
        className="fixed z-50 space-y-3 overflow-y-auto rounded-xl border border-border bg-surface p-4 shadow-2xl outline-none"
        style={{
          left: position.left,
          top: position.top,
          width: CARD_WIDTH,
          maxWidth: 'calc(100vw - 16px)',
          maxHeight: 'calc(100vh - 16px)',
        }}
      >
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <p className="text-xs text-fg-muted">
              Getting started · {index + 1} of {STEPS.length}
            </p>
            <h2 id="tour-title" className="text-base font-semibold">
              {step.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={closeTour}
            aria-label="Skip the tour"
            title="Skip the tour (Esc)"
            className="rounded-md p-1 text-fg-muted hover:bg-surface-3 hover:text-fg"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <p id="tour-text" className="text-sm">
          {step.text}
        </p>
        <div className="flex items-center justify-between gap-2">
          <button type="button" className={buttonClass} disabled={index === 0} onClick={back}>
            <ArrowLeft aria-hidden className="size-4" />
            Back
          </button>
          <button
            ref={next}
            type="button"
            className={primaryButtonClass}
            onClick={() => (last ? closeTour() : setIndex(index + 1))}
          >
            {last ? 'Done' : 'Next'}
            {!last && <ArrowRight aria-hidden className="size-4" />}
          </button>
        </div>
      </div>
    </>
  )
}
