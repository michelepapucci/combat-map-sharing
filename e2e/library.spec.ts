import { expect, test, type Page } from '@playwright/test'
import { makePng } from './png.ts'

/**
 * Milestone 3 smoke tests: autosave and restore, scenes, uploads and the
 * single DM window. Each test gets a fresh browser context, so IndexedDB
 * starts empty.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

async function itemCount(page: Page): Promise<number> {
  return page.evaluate(() => window.Konva?.stages[0]?.find('.item').length ?? 0)
}

async function itemSizes(page: Page): Promise<{ className: string; w: number; h: number }[]> {
  return page.evaluate(
    () =>
      window.Konva?.stages[0]
        ?.find('.item')
        .map((n) => ({ className: n.getClassName(), w: n.width(), h: n.height() })) ?? [],
  )
}

function libraryButton(page: Page, name: string) {
  return page.getByRole('tabpanel').getByRole('button', { name: new RegExp(`^${name}`) })
}

/** Waits for an edit to be saved: the indicator goes through "Unsaved changes" (1 s debounce). */
async function saved(page: Page) {
  await expect(page.getByText('Unsaved changes')).toBeVisible()
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
}

test('changes autosave and come back after a reload', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Grass' }).click()
  await libraryButton(page, 'Goblin').click()
  await saved(page)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Combat Map' })).toBeVisible()
  await expect.poll(() => itemCount(page)).toBe(2)
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
  expect(errors).toStrictEqual([])
})

test('scenes: add, rename, duplicate, reorder, delete with confirmation, undo', async ({
  page,
}) => {
  const errors = trackErrors(page)
  await page.goto('./#/dm')
  const scenes = page.getByRole('navigation', { name: 'Scenes' })
  await page.getByRole('button', { name: 'Dirt' }).click()

  await scenes.getByRole('button', { name: 'Add scene' }).click()
  await expect(scenes.getByRole('button', { name: 'Scene 2', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  // The new scene is empty.
  await expect(
    page.getByRole('heading', { name: 'Drop a map image here or pick a default map' }),
  ).toBeVisible()

  await scenes.getByRole('button', { name: 'Scene 2', exact: true }).dblclick()
  await scenes.getByRole('textbox', { name: 'Scene name' }).fill('Cellar')
  await page.keyboard.press('Enter')
  await expect(scenes.getByRole('button', { name: 'Cellar', exact: true })).toBeVisible()

  // The ⋯ button toggles its menu.
  const cellarActions = scenes.getByRole('button', { name: 'Actions for scene Cellar' })
  await cellarActions.click()
  await expect(page.getByRole('menu')).toBeVisible()
  await cellarActions.click()
  await expect(page.getByRole('menu')).toBeHidden()
  await cellarActions.click()
  await page.getByRole('menuitem', { name: 'Move left' }).click()
  // Focus returns to the active tab after a scene action.
  await expect(scenes.getByRole('button', { name: 'Cellar', exact: true })).toBeFocused()
  await expect(scenes.getByRole('button').first()).toHaveText('Cellar')

  // Back to the first scene: its map is still there.
  await scenes.getByRole('button', { name: 'Scene 1', exact: true }).click()
  await expect.poll(() => itemCount(page)).toBe(1)

  await scenes.getByRole('button', { name: 'Actions for scene Scene 1' }).click()
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(scenes.getByRole('button', { name: 'Scene 1 (copy)', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect.poll(() => itemCount(page)).toBe(1)

  await scenes.getByRole('button', { name: 'Actions for scene Scene 1 (copy)' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete scene?' })
  await expect(dialog).toContainText('Undo brings it back')
  await dialog.getByRole('button', { name: 'Delete scene' }).click()
  await expect(scenes.getByRole('button', { name: 'Scene 1 (copy)', exact: true })).toBeHidden()

  await page.keyboard.press('Control+z')
  await expect(scenes.getByRole('button', { name: 'Scene 1 (copy)', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  expect(errors).toStrictEqual([])
})

test('uploading a token image adds it to the library and places it with an image', async ({
  page,
}) => {
  const errors = trackErrors(page)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Grass' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await (
    await chooser
  ).setFiles({
    name: 'orc_chief.png',
    mimeType: 'image/png',
    buffer: makePng(64, 64, (x: number) => [x * 4, 120, 60]),
  })
  await expect(page.getByText('Added 1 token image to the library.')).toBeVisible()
  // A single upload opens for review: name, tags, defaults.
  const dialog = page.getByRole('dialog', { name: 'Edit image' })
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('orc chief')
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Orc chief')
  await dialog.getByRole('textbox', { name: /Tags/ }).fill('boss, Orcs')
  await dialog.getByRole('combobox', { name: 'Default size' }).selectOption('large')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  await libraryButton(page, 'Orc chief').click()
  await expect(page.getByRole('textbox', { name: 'Name (DM only)' })).toHaveValue('Orc chief 1')
  // The token draws the uploaded image (a Konva Image inside the token group, 2 cells wide).
  await expect
    .poll(() =>
      page.evaluate(
        () => window.Konva?.stages[0]?.find('Image').filter((n) => n.width() < 200).length ?? 0,
      ),
    )
    .toBe(1)

  // Search finds it by tag.
  await page.getByRole('searchbox').fill('orcs')
  await expect(libraryButton(page, 'Orc chief')).toBeVisible()
  await expect(libraryButton(page, 'Goblin')).toBeHidden()
  expect(errors).toStrictEqual([])
})

test('a map dropped on the canvas is imported, downscaled over 8192 px, and placed', async ({
  page,
}) => {
  const errors = trackErrors(page)
  await page.goto('./#/dm')
  await expect(page.getByTestId('dm-canvas')).toBeVisible()
  const png = makePng(9000, 120)
  const dataTransfer = await page.evaluateHandle(
    (bytes) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([new Uint8Array(bytes)], 'long-hall.png', { type: 'image/png' }))
      return transfer
    },
    [...png],
  )
  await page.dispatchEvent('[data-testid="dm-canvas"]', 'drop', { dataTransfer })
  await expect(
    page.getByText(/long-hall\.png was downscaled from 9000 × 120 to 8192 × 109/),
  ).toBeVisible()
  await expect.poll(() => itemSizes(page)).toStrictEqual([{ className: 'Image', w: 8192, h: 109 }])
  await page.getByRole('tab', { name: 'Maps' }).click()
  await expect(libraryButton(page, 'long hall')).toBeVisible()
  expect(errors).toStrictEqual([])
})

test('deleting an image in use warns, then removes its items', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Grass' }).click()
  await page.getByRole('tab', { name: 'Props' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await (
    await chooser
  ).setFiles({ name: 'cart.png', mimeType: 'image/png', buffer: makePng(200, 100) })
  await page
    .getByRole('dialog', { name: 'Edit image' })
    .getByRole('button', { name: 'Cancel' })
    .click()
  await libraryButton(page, 'cart').click()
  await libraryButton(page, 'cart').click()
  await expect.poll(() => itemCount(page)).toBe(3)

  await page.getByRole('button', { name: 'Edit cart' }).click()
  await page.getByRole('button', { name: 'Delete image…' }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete image?' })
  await expect(confirm).toContainText('It is used by 2 items in 1 scene')
  await confirm.getByRole('button', { name: 'Delete image' }).click()
  await expect.poll(() => itemCount(page)).toBe(1)
  await expect(libraryButton(page, 'cart')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()

  // A file that is not an image is refused with a reason.
  const chooser2 = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await (
    await chooser2
  ).setFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('not a png') })
  await expect(page.getByText('notes.png is not a PNG, JPEG or WebP image.')).toBeVisible()
  expect(errors).toStrictEqual([])
})

test('campaigns: create, switch, rename and delete', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Stone floor' }).click()
  await page.getByRole('button', { name: /^Campaign: New campaign/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Campaigns' })
  const name = dialog.getByRole('textbox', { name: 'Name of this campaign' })
  await name.fill('Tuesday group')
  await name.press('Enter')
  await dialog.getByRole('button', { name: 'New campaign' }).click()
  await expect(page.getByRole('button', { name: /^Campaign: New campaign/ })).toBeVisible()
  await expect.poll(() => itemCount(page)).toBe(0)

  await page.getByRole('button', { name: /^Campaign: New campaign/ }).click()
  await dialog.getByRole('button', { name: 'Open Tuesday group' }).click()
  await expect(page.getByRole('button', { name: /^Campaign: Tuesday group/ })).toBeVisible()
  await expect.poll(() => itemCount(page)).toBe(1)

  await page.getByRole('button', { name: /^Campaign: Tuesday group/ }).click()
  await dialog.getByRole('button', { name: 'Delete New campaign' }).click()
  await page
    .getByRole('dialog', { name: 'Delete campaign?' })
    .getByRole('button', { name: 'Delete campaign' })
    .click()
  await expect(dialog.getByRole('listitem')).toHaveCount(1)
  expect(errors).toStrictEqual([])
})

test('a second DM tab waits, and can take over after the first one saves', async ({
  page,
  context,
}) => {
  const errors = trackErrors(page)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Grass' }).click()
  await libraryButton(page, 'Wolf').click()

  const second = await context.newPage()
  const secondErrors = trackErrors(second)
  await second.goto('./#/dm')
  await expect(
    second.getByRole('heading', { name: 'Combat Map is already open in another tab' }),
  ).toBeVisible()
  await second.getByRole('button', { name: 'Use this tab instead' }).click()
  // The first tab saved before handing over, so the wolf is there.
  await expect(second.getByRole('heading', { name: 'Combat Map' })).toBeVisible()
  await expect.poll(() => itemCount(second)).toBe(2)
  await expect(
    page.getByRole('heading', { name: 'The campaign is now open in another tab' }),
  ).toBeVisible()
  expect(errors).toStrictEqual([])
  expect(secondErrors).toStrictEqual([])
})
