/// <reference types="vitest/config" />
import { createHash } from 'node:crypto'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * GitHub Pages serves a project site under `/<repo-name>/`. CI passes the exact
 * path reported by `actions/configure-pages` (e.g. `/combat-map-sharing`, or ``
 * for a user site / custom domain) in BASE_PATH. Locally we default to the repo
 * name so dev, preview and production all run under the same base.
 */
const DEFAULT_BASE = '/combat-map-sharing/'

function normalizeBase(raw: string | undefined): string {
  if (raw === undefined) return DEFAULT_BASE
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, '')
  return trimmed === '' ? '/' : `/${trimmed}/`
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('base64')

/**
 * Production-only Content-Security-Policy (as a <meta> tag, since GitHub Pages
 * cannot send headers). It enforces the spec's hard constraint mechanically: the
 * only network origins the app may talk to are the GitHub API and gist raw URLs
 * (gist sync, milestone 8). Inline scripts are allowed only by hash.
 * Not applied in dev because the dev server injects inline scripts for HMR.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'vtt-content-security-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // Browsers hash inline scripts after normalising newlines (CRLF/CR -> LF).
        const inlineScriptHashes = [
          ...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
        ].map((m) => `'sha256-${sha256((m[1] ?? '').replace(/\r\n?/g, '\n'))}'`)
        const policy = [
          "default-src 'self'",
          ["script-src 'self'", ...inlineScriptHashes].join(' '),
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' blob: data:",
          "font-src 'self'",
          "connect-src 'self' blob: data: https://api.github.com https://gist.githubusercontent.com",
          "worker-src 'self' blob:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'none'",
        ].join('; ')
        // Right after <meta charset>: a <meta> CSP only governs elements that follow it.
        const charset = /<meta charset="[^"]*"\s*\/?>/i
        if (!charset.test(html)) throw new Error('index.html must declare <meta charset> first')
        const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`
        return html.replace(charset, (tag) => `${tag}\n    ${meta}`)
      },
    },
  }
}

export default defineConfig({
  base: normalizeBase(process.env.BASE_PATH),
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
})
