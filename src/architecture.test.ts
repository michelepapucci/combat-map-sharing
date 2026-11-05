import { describe, expect, it } from 'vitest'
import { THEME_STORAGE_KEY } from './app/theme'

/**
 * Architecture guards that lint cannot express (lint sees only direct imports).
 * See CLAUDE.md, "Projection rule" and "Conventions".
 */

// Every source file as text, keyed "/src/...".
const sources = import.meta.glob<string>('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const STATIC_IMPORT = /^\s*(?:import|export)\s+(type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm
const DYNAMIC_IMPORT = /import\(\s*['"]([^'"]+)['"]\s*\)/g

interface ImportRef {
  target: string
  dynamic: boolean
}

function resolve(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null // a package
  const parts: string[] = []
  for (const part of [...from.split('/').slice(0, -1), ...specifier.split('/')]) {
    if (part === '..') parts.pop()
    else if (part !== '.') parts.push(part)
  }
  const base = parts.join('/')
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
  return candidates.find((candidate) => candidate in sources) ?? null
}

/** Runtime imports of a module (type-only imports are erased and do not count). */
function importsOf(file: string): ImportRef[] {
  const text = sources[file] ?? ''
  const refs: ImportRef[] = []
  for (const m of text.matchAll(STATIC_IMPORT)) {
    const target = m[1] ? null : resolve(file, m[2] ?? '')
    if (target) refs.push({ target, dynamic: false })
  }
  for (const m of text.matchAll(DYNAMIC_IMPORT)) {
    const target = resolve(file, m[1] ?? '')
    if (target) refs.push({ target, dynamic: true })
  }
  return refs
}

function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>([entry])
  const queue = [entry]
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    for (const { target } of importsOf(file)) {
      if (!seen.has(target)) {
        seen.add(target)
        queue.push(target)
      }
    }
  }
  return seen
}

/** Modules the player window must never evaluate. */
const DM_ONLY =
  /^\/src\/(?:dm|panels|tools|gist|store)\/|^\/src\/persistence\/(?!assetBlobs\.ts$)|^\/src\/app\/App\.tsx$/

describe('architecture', () => {
  it('finds the source files and resolves relative imports', () => {
    expect(Object.keys(sources)).toContain('/src/player/PlayerApp.tsx')
    expect(reachableFrom('/src/app/App.tsx')).toContain('/src/app/route.ts')
  })

  it('the player window cannot reach DM-only modules, even transitively', () => {
    const forbidden = [...reachableFrom('/src/player/PlayerApp.tsx')].filter((f) => DM_ONLY.test(f))
    expect(forbidden).toStrictEqual([])
  })

  it('player and shared canvas code read only asset blobs, never the database itself', () => {
    const shared = [...reachableFrom('/src/player/PlayerApp.tsx')].filter(
      (file) => !file.startsWith('/src/persistence/'),
    )
    const offenders = shared.filter((file) =>
      /\bopenVttDb\b|\bindexedDB\b/.test(sources[file] ?? ''),
    )
    expect(offenders).toStrictEqual([])
    const canvas = Object.keys(sources).filter((file) => file.startsWith('/src/canvas/'))
    expect(
      canvas.filter((file) => /\bopenVttDb\b|\bindexedDB\b/.test(sources[file] ?? '')),
    ).toStrictEqual([])
  })

  it('the app shell loads each window lazily, so the bundles stay separate', () => {
    const windows = importsOf('/src/app/App.tsx').filter(({ target }) =>
      ['/src/dm/DmApp.tsx', '/src/player/PlayerApp.tsx'].includes(target),
    )
    expect(windows).toHaveLength(2)
    expect(windows.every((ref) => ref.dynamic)).toBe(true)
  })

  it('pure folders contain no .tsx files (JSX would import React implicitly)', () => {
    const tsx = Object.keys(sources).filter((f) =>
      /^\/src\/(?:geometry|projection)\/.*\.tsx$/.test(f),
    )
    expect(tsx).toStrictEqual([])
  })

  it("index.html's pre-paint theme script reads the same storage key as theme.ts", async () => {
    const html = (await import('/index.html?raw')).default
    expect(html).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`)
  })
})
