import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/**
 * The DM's side panels: cards that collapse, pop out of the sidebar to float
 * over the map wherever the DM drags them, dock back, and remember all of it
 * on this device.
 */

function trackErrors(context: BrowserContext): string[] {
  const errors: string[] = []
  context.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${msg.page()?.url() ?? '?'}: ${msg.text()}`)
  })
  context.on('weberror', (err) => errors.push(err.error().message))
  return errors
}

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Panels' })
const panel = (page: Page, id: string) => page.locator(`[data-panel="${id}"]`)

async function box(page: Page, id: string) {
  const rect = await panel(page, id).boundingBox()
  if (!rect) throw new Error(`panel ${id} not shown`)
  return rect
}

test('panels pop out, move, collapse, dock back, and keep their place after a reload', async ({
  page,
  context,
}) => {
  const errors = trackErrors(context)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Dirt' }).click()
  await expect(sidebar(page).locator('[data-panel="initiative"]')).toHaveCount(1)

  // "Edit token" expands a collapsed Properties panel.
  await page.getByRole('button', { name: 'Collapse Properties' }).click()
  await page
    .getByRole('tabpanel')
    .getByRole('button', { name: /^Goblin/ })
    .click()
  const goblin = await page.evaluate(() => {
    const node = window.Konva?.stages[0]?.find('.item').at(-1)
    const r = node?.getClientRect()
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
  })
  const area = await page.getByTestId('dm-canvas').boundingBox()
  if (!goblin || !area) throw new Error('goblin not drawn')
  await page.mouse.click(area.x + goblin.x, area.y + goblin.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit token' }).click()
  await expect(page.getByRole('textbox', { name: 'Name (DM only)' })).toBeFocused()

  // Pop out with the button: it floats over the map, out of the sidebar.
  await page.getByRole('button', { name: 'Pop out Initiative' }).click()
  await expect(sidebar(page).locator('[data-panel="initiative"]')).toHaveCount(0)
  await expect(panel(page, 'initiative')).toBeVisible()

  // Drag it by its header.
  const before = await box(page, 'initiative')
  await page.mouse.move(before.x + 120, before.y + 18)
  await page.mouse.down()
  await page.mouse.move(before.x + 20, before.y + 120, { steps: 8 })
  await page.mouse.up()
  const moved = await box(page, 'initiative')
  expect(moved.x).toBeCloseTo(before.x - 100, -1)
  expect(moved.y).toBeCloseTo(before.y + 102, -1)
  // The keyboard moves it too.
  await page
    .getByRole('button', { name: 'Move the Initiative panel (arrow keys)' })
    .press('ArrowRight')
  expect((await box(page, 'initiative')).x).toBeCloseTo(moved.x + 16, 0)

  // Collapse it, and drag the Library's header out of the sidebar.
  await page.getByRole('button', { name: 'Collapse Initiative' }).click()
  await expect(page.getByRole('checkbox', { name: 'Show tracker to players' })).toBeHidden()
  const header = panel(page, 'library').locator('header')
  await header.scrollIntoViewIfNeeded()
  const library = await header.boundingBox()
  if (!library) throw new Error('no library header')
  await page.mouse.move(library.x + 100, library.y + library.height / 2)
  await page.mouse.down()
  await page.mouse.move(library.x - 300, library.y + 60, { steps: 8 })
  await page.mouse.up()
  await expect(sidebar(page).locator('[data-panel="library"]')).toHaveCount(0)
  await expect(panel(page, 'library')).toBeVisible()

  // A reload keeps the layout (a device preference, not campaign data).
  const kept = await box(page, 'initiative')
  await page.waitForTimeout(400) // the layout is written a moment after the last change
  await page.reload()
  await expect(panel(page, 'initiative')).toBeVisible()
  expect(await box(page, 'initiative')).toStrictEqual(kept)
  await expect(page.getByRole('button', { name: 'Expand Initiative' })).toBeVisible()
  await expect(sidebar(page).locator('[data-panel="library"]')).toHaveCount(0)

  // Dock both back (the library, popped out last, is on top).
  await page.getByRole('button', { name: 'Dock Library in the sidebar' }).click()
  await page.getByRole('button', { name: 'Dock Initiative in the sidebar' }).click()
  await expect(sidebar(page).locator('[data-panel="initiative"]')).toHaveCount(1)
  await expect(sidebar(page).locator('[data-panel="library"]')).toHaveCount(1)
  expect(errors).toStrictEqual([])
})

test('with every panel popped out the map takes the whole width', async ({ page, context }) => {
  const errors = trackErrors(context)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Dirt' }).click()
  const canvas = page.getByTestId('dm-canvas')
  const narrow = (await canvas.boundingBox())?.width ?? 0
  for (const title of ['Player view', 'Initiative', 'Library', 'Layers', 'Properties', 'Scene']) {
    await page.getByRole('button', { name: `Pop out ${title}` }).click()
  }
  await expect(sidebar(page)).toHaveCount(0)
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeGreaterThan(narrow + 250)
  // Dock everything back, topmost first: the sidebar returns.
  for (const title of ['Scene', 'Properties', 'Layers', 'Library', 'Initiative', 'Player view']) {
    await page.getByRole('button', { name: `Dock ${title} in the sidebar` }).click()
  }
  await expect(sidebar(page).locator('[data-panel]')).toHaveCount(6)
  expect(errors).toStrictEqual([])
})
