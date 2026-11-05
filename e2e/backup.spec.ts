import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { makePng } from './png.ts'

/**
 * Milestone 8: SPEC §9 "export and re-import a local backup zip". The backup is
 * restored in a fresh browser context (empty IndexedDB), as on another computer.
 */

function trackErrors(context: BrowserContext): string[] {
  const errors: string[] = []
  context.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${msg.page()?.url() ?? '?'}: ${msg.text()}`)
  })
  context.on('weberror', (err) => errors.push(err.error().message))
  return errors
}

function libraryButton(page: Page, name: string) {
  return page.getByRole('tabpanel').getByRole('button', { name: new RegExp(`^${name}`) })
}

async function imageTokens(page: Page): Promise<number> {
  return page.evaluate(
    () => window.Konva?.stages[0]?.find('Image').filter((n) => n.width() < 200).length ?? 0,
  )
}

test('a backup zip exports the campaign with its images and imports on another device', async ({
  page,
  context,
  browser,
}, testInfo) => {
  const errors = trackErrors(context)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Grass' }).click()
  // An uploaded token image, placed.
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await (
    await chooser
  ).setFiles({
    name: 'troll.png',
    mimeType: 'image/png',
    buffer: makePng(48, 48, (x: number) => [200, x * 5, 40]),
  })
  await page
    .getByRole('dialog', { name: 'Edit image' })
    .getByRole('button', { name: 'Save' })
    .click()
  await libraryButton(page, 'troll').click()
  await expect.poll(() => imageTokens(page)).toBe(1)
  // A name to recognize it by.
  await page.getByRole('button', { name: /^Campaign: / }).click()
  const dialog = page.getByRole('dialog', { name: 'Campaigns' })
  await dialog.getByRole('textbox', { name: 'Name of this campaign' }).fill('Troll bridge')
  await dialog.getByRole('textbox', { name: 'Name of this campaign' }).press('Enter')

  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /Export “Troll bridge”/ }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^Troll bridge \d{4}-\d{2}-\d{2}\.vtt\.zip$/)
  const path = testInfo.outputPath('backup.zip')
  await file.saveAs(path)

  // Another "computer": a fresh context with empty storage.
  const other = await browser.newContext()
  const otherErrors = trackErrors(other)
  const fresh = await other.newPage()
  await fresh.goto('./#/dm')
  await fresh.getByRole('button', { name: /^Campaign: / }).click()
  const otherDialog = fresh.getByRole('dialog', { name: 'Campaigns' })
  const picker = fresh.waitForEvent('filechooser')
  await otherDialog.getByRole('button', { name: 'Import a backup…' }).click()
  await (await picker).setFiles(path)
  await expect(fresh.getByText('Imported “Troll bridge”.')).toBeVisible()
  await expect(fresh.getByRole('button', { name: /^Campaign: Troll bridge\./ })).toBeVisible()
  // The image came along: the token still draws it, and the library lists it.
  await expect.poll(() => imageTokens(fresh)).toBe(1)
  await expect(libraryButton(fresh, 'troll')).toBeVisible()

  // Importing it again where it already exists asks: replace, or keep both.
  await fresh.getByRole('button', { name: /^Campaign: Troll bridge\./ }).click()
  const again = fresh.waitForEvent('filechooser')
  await fresh.getByRole('button', { name: 'Import a backup…' }).click()
  await (await again).setFiles(path)
  await fresh.getByRole('button', { name: 'Import as a copy' }).click()
  await expect(fresh.getByText('Imported “Troll bridge (restored)”.')).toBeVisible()
  await other.close()
  expect(errors).toStrictEqual([])
  expect(otherErrors).toStrictEqual([])
})
