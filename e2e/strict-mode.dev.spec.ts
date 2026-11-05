import { expect, test, type Page } from '@playwright/test'
import { makePng } from './png.ts'

/**
 * The same app under the Vite dev server, where React StrictMode mounts every
 * component twice. Covers the UI whose effects open or close things (dialogs,
 * menus, the session), which is where StrictMode-only bugs hide.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

test('dialogs open, stay open, and leave the page usable after closing', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Grass' }).click()

  // Settings: change the diagonal rule, close with Esc.
  await page.getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  await settings.getByRole('combobox', { name: 'Diagonal movement' }).selectOption('euclidean')
  await expect(settings).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()

  // Campaigns: rename, create a new one, go back.
  await page.getByRole('button', { name: /^Campaign: New campaign/ }).click()
  const campaigns = page.getByRole('dialog', { name: 'Campaigns' })
  await expect(campaigns).toBeVisible()
  const name = campaigns.getByRole('textbox', { name: 'Name of this campaign' })
  await name.fill('Dev campaign')
  await name.press('Enter')
  await expect(page.getByRole('button', { name: /^Campaign: Dev campaign/ })).toBeVisible()
  await campaigns.getByRole('button', { name: 'New campaign' }).click()
  await expect(campaigns).toBeHidden()
  await page.getByRole('button', { name: /^Campaign: New campaign/ }).click()
  await campaigns.getByRole('button', { name: 'Open Dev campaign' }).click()
  await expect(page.getByRole('button', { name: /^Campaign: Dev campaign/ })).toBeVisible()

  // A confirmation dialog: deleting a scene goes through, and the page stays clickable.
  const scenes = page.getByRole('navigation', { name: 'Scenes' })
  await scenes.getByRole('button', { name: 'Add scene' }).click()
  await scenes.getByRole('button', { name: 'Actions for scene Scene 2' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete scene?' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Delete scene' }).click()
  await expect(scenes.getByRole('button', { name: 'Scene 2', exact: true })).toBeHidden()
  await scenes.getByRole('button', { name: 'Add scene' }).click()
  await expect(scenes.getByRole('button', { name: 'Scene 2', exact: true })).toBeVisible()

  // A single upload opens its review dialog, which stays open until saved.
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await (
    await chooser
  ).setFiles({ name: 'knight.png', mimeType: 'image/png', buffer: makePng(64, 64) })
  const review = page.getByRole('dialog', { name: 'Edit image' })
  await expect(review).toBeVisible()
  await page.waitForTimeout(300)
  await expect(review).toBeVisible()
  await review.getByRole('button', { name: 'Save' }).click()
  await expect(review).toBeHidden()
  await page
    .getByRole('tabpanel')
    .getByRole('button', { name: /^knight/ })
    .click()
  await expect(page.getByRole('textbox', { name: 'Name (DM only)' })).toHaveValue('knight 1')

  // The cheat sheet still works too.
  await page.getByTestId('dm-canvas').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Shift+?')
  await expect(page.getByRole('dialog', { name: 'Keyboard and mouse' })).toBeVisible()
  expect(errors).toStrictEqual([])
})

test('the player window connects, renders and follows changes under StrictMode', async ({
  page,
}) => {
  const errors = trackErrors(page)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Grass' }).click()
  await page.getByRole('tabpanel').getByRole('button', { name: /^Wolf/ }).click()
  const popup = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Open player window' }).click()
  const player = await popup
  const playerErrors = trackErrors(player)
  await expect(page.getByText('1 window connected')).toBeVisible()
  const count = () => player.evaluate(() => window.Konva?.stages[0]?.find('.item').length ?? 0)
  await expect.poll(count).toBe(2)
  await page.keyboard.press('h') // hide the selected wolf
  await expect.poll(count).toBe(1)
  await page.close()
  await expect(player.getByText('DM window disconnected')).toBeVisible()
  expect(errors).toStrictEqual([])
  expect(playerErrors).toStrictEqual([])
})
