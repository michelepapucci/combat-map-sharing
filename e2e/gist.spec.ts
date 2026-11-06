import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { createFakeGitHub, TEST_LOGIN, TEST_TOKEN } from './fakeGitHub.ts'
import { makePng } from './png.ts'

/**
 * Milestone 8: saving a campaign to a GitHub Gist and opening it on another
 * computer, against an in-memory GitHub (e2e/fakeGitHub.ts). The token only
 * ever travels in the Authorization header of api.github.com requests.
 */

function trackErrors(context: BrowserContext): string[] {
  const errors: string[] = []
  context.on('console', (msg) => {
    // The fake answers a wrong token with 401, which the browser logs as a failed request.
    if (msg.type() === 'error' && !msg.text().includes('401')) {
      errors.push(`${msg.page()?.url() ?? '?'}: ${msg.text()}`)
    }
  })
  context.on('weberror', (err) => errors.push(err.error().message))
  return errors
}

function libraryButton(page: Page, name: string) {
  return page.getByRole('tabpanel').getByRole('button', { name: new RegExp(`^${name}`) })
}

/**
 * Closes a dialog and waits until the app has handled it. The native 'close'
 * event that clears the open dialog comes a task after the click, and until
 * then shortcuts such as Ctrl+S are ignored, as they are under any dialog.
 */
async function closeDialog(dialog: Locator) {
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: /^Settings/ }).click()
  return page.getByRole('dialog', { name: 'Settings' })
}

async function connect(page: Page) {
  const settings = await openSettings(page)
  await settings.getByLabel('GitHub token').fill(TEST_TOKEN)
  await settings.getByRole('button', { name: 'Connect' }).click()
  await expect(settings.getByText(`Connected to GitHub as ${TEST_LOGIN}.`)).toBeVisible()
  return settings
}

async function rename(page: Page, name: string) {
  await page.getByRole('button', { name: /^Campaign: / }).click()
  const dialog = page.getByRole('dialog', { name: 'Campaigns' })
  await dialog.getByRole('textbox', { name: 'Name of this campaign' }).fill(name)
  await dialog.getByRole('textbox', { name: 'Name of this campaign' }).press('Enter')
  await closeDialog(dialog)
}

test('a campaign saved to a gist opens on another computer, images included', async ({
  browser,
}) => {
  const github = createFakeGitHub()
  const first = await browser.newContext()
  await github.install(first)
  const errors = trackErrors(first)
  const page = await first.newPage()
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Grass' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await (
    await chooser
  ).setFiles({
    name: 'ogre.png',
    mimeType: 'image/png',
    buffer: makePng(40, 40, () => [90, 160, 60]),
  })
  await page
    .getByRole('dialog', { name: 'Edit image' })
    .getByRole('button', { name: 'Save' })
    .click()
  await libraryButton(page, 'ogre').click()
  await rename(page, 'Ogre cave')

  // A wrong token is refused.
  let settings = await openSettings(page)
  await settings.getByLabel('GitHub token').fill('github_pat_WRONG')
  await settings.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByText(/GitHub did not accept the token/)).toBeVisible()
  await closeDialog(settings)

  settings = await connect(page)
  await expect(settings.getByText('Secret gists are unlisted, not private:')).toBeVisible()
  await settings.getByRole('button', { name: 'Create a secret gist for “Ogre cave”' }).click()
  await expect(settings.getByText('Everything is saved to the gist.')).toBeVisible()
  await closeDialog(settings)
  await expect(page.getByRole('button', { name: 'Gist: synced' })).toBeVisible()

  const [gist] = [...github.gists.values()]
  if (!gist) throw new Error('no gist created')
  expect(gist.public).toBe(false)
  expect(gist.description).toBe('VTT campaign: Ogre cave')
  const files = Object.keys(gist.history[0]?.files ?? {})
  expect(files).toContain('vtt-manifest.json')
  expect(files).toContain('campaign.json')
  expect(files.filter((f) => /^asset-.+\.b64$/.test(f))).toHaveLength(1)
  // The token never appears in a URL or in the gist; raw files are fetched without it.
  for (const request of github.requests) expect(request.url).not.toContain(TEST_TOKEN)
  expect(JSON.stringify([...github.gists.values()])).not.toContain(TEST_TOKEN)

  // Another computer: open the gist by its address.
  const second = await browser.newContext()
  await github.install(second)
  const otherErrors = trackErrors(second)
  const other = await second.newPage()
  await other.goto('./#/dm')
  const otherSettings = await connect(other)
  await otherSettings
    .getByLabel('Or open a campaign from an existing gist')
    .fill(`https://gist.github.com/${TEST_LOGIN}/${gist.id}`)
  await otherSettings.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(other.getByText('Opened “Ogre cave” from the gist.')).toBeVisible()
  await expect(other.getByRole('button', { name: /^Campaign: Ogre cave\./ })).toBeVisible()
  await expect(libraryButton(other, 'ogre')).toBeVisible()
  await expect(other.getByRole('button', { name: 'Gist: synced' })).toBeVisible()
  for (const request of github.requests.filter((r) => r.url.includes('githubusercontent'))) {
    expect(request.auth).toBeNull()
  }

  // The second computer saves a change; the first one then finds the gist changed.
  await rename(other, 'Ogre cave (night)')
  await expect(other.getByRole('button', { name: 'Gist: unsynced' })).toBeVisible()
  await other.getByTestId('dm-canvas').focus()
  await other.keyboard.press('Control+s')
  await expect(other.getByRole('button', { name: 'Gist: synced' })).toBeVisible()

  await rename(page, 'Ogre cave (day)')
  await page.getByTestId('dm-canvas').focus()
  await page.keyboard.press('Control+s')
  const conflict = page.getByRole('dialog', { name: 'The gist changed on another device' })
  await expect(conflict).toBeVisible()
  await conflict.getByRole('button', { name: 'Load the gist' }).click()
  await expect(page.getByRole('button', { name: /^Campaign: Ogre cave \(night\)\./ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Gist: synced' })).toBeVisible()

  await first.close()
  await second.close()
  expect(errors).toStrictEqual([])
  expect(otherErrors).toStrictEqual([])
})
