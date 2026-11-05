import { expect, test } from '@playwright/test'

/** The getting-started tour (SPEC §8 "4-step hint overlay"): first run only, dismissible. */

test.use({ storageState: { cookies: [], origins: [] } })

test('the tour shows once on a new device, walks four steps, and can be shown again', async ({
  page,
}) => {
  await page.goto('./#/dm')
  const card = page.getByRole('dialog', { name: 'The map' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('1 of 4')
  await card.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('dialog', { name: 'Tokens and props' })).toBeVisible()
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('dialog', { name: 'The players’ screen' })).toBeVisible()
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('dialog', { name: 'Tokens and props' })).toBeVisible()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('dialog', { name: 'At the table' })).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('dialog', { name: 'At the table' })).toBeHidden()

  // Not again after a reload.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Combat Map' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'The map' })).toBeHidden()

  // The cheat sheet brings it back, from the first step.
  await page.getByTestId('dm-canvas').focus()
  await page.keyboard.press('?')
  await page.getByRole('button', { name: 'Show the getting-started tour again' }).click()
  await expect(page.getByRole('dialog', { name: 'The map' })).toBeVisible()
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('dialog', { name: 'Tokens and props' })).toBeVisible()

  // Esc closes a dialog opened over the tour first, then skips the tour.
  await page.keyboard.press('?')
  const cheatSheet = page.getByRole('dialog', { name: 'Keyboard and mouse' })
  await expect(cheatSheet).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(cheatSheet).toBeHidden()
  await expect(page.getByRole('dialog', { name: 'Tokens and props' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Tokens and props' })).toBeHidden()

  // Reopened, it starts again at the first step.
  await page.keyboard.press('?')
  await page.getByRole('button', { name: 'Show the getting-started tour again' }).click()
  await expect(page.getByRole('dialog', { name: 'The map' })).toContainText('1 of 4')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'The map' })).toBeHidden()
})
