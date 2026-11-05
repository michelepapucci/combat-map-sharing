import { useSyncExternalStore } from 'react'

/** Re-renders when the theme (an attribute on <html>) changes. */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

const getTheme = () => document.documentElement.dataset.theme ?? ''

/** Resolved values per theme and property, so renders never force a style recalculation. */
const cache = new Map<string, string>()

/** The current value of a CSS custom property on <html>, for drawing theme colors on the canvas. */
export function useCssColor(name: string, fallback: string): string {
  const theme = useSyncExternalStore(subscribe, getTheme)
  const key = `${theme}|${name}`
  let value = cache.get(key)
  if (value === undefined) {
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    cache.set(key, value)
  }
  return value || fallback
}
