import { defineConfig, devices } from '@playwright/test'

// Smoke tests run against the production build served by `vite preview`, under the
// same base path as GitHub Pages, so base-path and bundling mistakes are caught.
// A dedicated port and no server reuse: every run builds and serves a fresh dist/
// (4173 is `npm run preview`'s default, which would otherwise be reused stale).
// The `dev` project runs `*.dev.spec.ts` against the Vite dev server, where React
// StrictMode runs every effect twice: bugs that only show up there (a dialog that
// closes itself) would otherwise slip through, and the DM tests in dev mode.
const PORT = 4179
const DEV_PORT = 4178
const BASE = '/combat-map-sharing/'
const isCI = !!process.env.CI

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /\.dev\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PORT}${BASE}` },
    },
    {
      name: 'dev',
      testMatch: /\.dev\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${DEV_PORT}${BASE}` },
    },
  ],
  webServer: [
    {
      command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}${BASE}`,
      reuseExistingServer: false,
      env: { BASE_PATH: BASE },
      timeout: 120_000,
    },
    {
      command: `npx vite --port ${DEV_PORT} --strictPort`,
      url: `http://localhost:${DEV_PORT}${BASE}`,
      reuseExistingServer: false,
      env: { BASE_PATH: BASE },
      timeout: 120_000,
    },
  ],
})
