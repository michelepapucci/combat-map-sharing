import { defineConfig, devices } from '@playwright/test'

// Smoke tests run against the production build served by `vite preview`, under the
// same base path as GitHub Pages, so base-path and bundling mistakes are caught.
// A dedicated port and no server reuse: every run builds and serves a fresh dist/
// (4173 is `npm run preview`'s default, which would otherwise be reused stale).
const PORT = 4179
const BASE = '/combat-map-sharing/'
const isCI = !!process.env.CI

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}${BASE}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}${BASE}`,
    reuseExistingServer: false,
    env: { BASE_PATH: BASE },
    timeout: 120_000,
  },
})
