import { expect, test, type BrowserContext } from '@playwright/test'

/**
 * Collects console errors and uncaught exceptions (including CSP violations) from
 * every page in the context, popups included, from before they start loading.
 */
function trackErrors(context: BrowserContext): string[] {
  const errors: string[] = []
  context.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${msg.page()?.url() ?? '?'}: ${msg.text()}`)
  })
  context.on('weberror', (err) => errors.push(err.error().message))
  return errors
}

test('an empty hash opens the DM view and normalises the URL', async ({ page, context }) => {
  const errors = trackErrors(context)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Combat Map' })).toBeVisible()
  await expect(page).toHaveURL(/#\/dm$/)
  await expect(page).toHaveTitle('Combat Map (DM)')
  expect(errors).toStrictEqual([])
})

test('the theme toggle switches and persists the theme', async ({ page, context }) => {
  const errors = trackErrors(context)
  await page.goto('./#/dm')
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await expect(html).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'light')
  expect(errors).toStrictEqual([])
})

test('the pre-paint script applies the saved theme before any app code runs', async ({ page }) => {
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  // Block the app bundle: only the inline script in index.html can set the theme now.
  // It must also be allowed by the CSP hash, or it would not run either.
  await page.route('**/assets/*.js', (route) => route.abort())
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('"Open player window" opens #/player in a new window', async ({ page, context }) => {
  const errors = trackErrors(context)
  await page.goto('./#/dm')
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Open player window' }).click()
  const popup = await popupPromise
  await expect(popup).toHaveURL(/#\/player$/)
  await expect(popup).toHaveTitle('Player view')
  // The DM window is open, so the player connects at once.
  await expect(page.getByText('1 window connected')).toBeVisible()
  await expect(popup.getByText('Connecting to the DM window…')).toBeHidden()
  expect(errors).toStrictEqual([])
})

test('the player window is black and never loads DM code', async ({ page, context }) => {
  const errors = trackErrors(context)
  const scripts: string[] = []
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(request.url())
  })
  // Even when the DM uses the light theme on this device.
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  scripts.length = 0

  await page.goto('./#/player')
  await page.reload()
  await expect(page.getByText('Connecting to the DM window…')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-view', 'player')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(background).toBe('rgb(0, 0, 0)')
  expect(scripts.some((url) => /\/PlayerApp-[\w-]+\.js$/.test(url))).toBe(true)
  expect(scripts.filter((url) => /\/DmApp-[\w-]+\.js$/.test(url))).toStrictEqual([])
  expect(errors).toStrictEqual([])
})

test('the production build ships a Content-Security-Policy', async ({ page }) => {
  await page.goto('./#/dm')
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content')
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain('connect-src')
  expect(csp).toContain('https://api.github.com')
})

test('the CSP blocks network requests to non-GitHub origins', async ({ page }) => {
  await page.goto('./#/dm')
  const violatedDirective = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        document.addEventListener('securitypolicyviolation', (e) => resolve(e.effectiveDirective), {
          once: true,
        })
        setTimeout(() => resolve('no violation'), 3000)
        fetch('https://example.com/', { mode: 'no-cors' }).catch(() => undefined)
      }),
  )
  expect(violatedDirective).toBe('connect-src')
})
