import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/**
 * Milestone 7: the ruler (shared with players on request) and area-of-effect
 * templates (placed, pinned, hidden from players, deleted).
 */

function trackErrors(context: BrowserContext): string[] {
  const errors: string[] = []
  context.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${msg.page()?.url() ?? '?'}: ${msg.text()}`)
  })
  context.on('weberror', (err) => errors.push(err.error().message))
  return errors
}

async function openPlayer(page: Page): Promise<Page> {
  const popup = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Open player window' }).click()
  const player = await popup
  await expect(page.getByText('1 window connected')).toBeVisible()
  return player
}

/** Page coordinates of a world (map) point on the DM canvas. */
async function screenOf(page: Page, world: { x: number; y: number }) {
  const canvas = await page.getByTestId('dm-canvas').boundingBox()
  const p = await page.evaluate(
    (w) => window.Konva?.stages[0]?.getAbsoluteTransform().point(w) ?? null,
    world,
  )
  if (!canvas || !p) throw new Error('no canvas')
  return { x: canvas.x + p.x, y: canvas.y + p.y }
}

/** The center of cell (i, j) on the default 70 px grid. */
const cell = (i: number, j: number) => ({ x: i * 70 + 35, y: j * 70 + 35 })

async function texts(page: Page): Promise<string[]> {
  return page.evaluate(
    () => window.Konva?.stages[0]?.find('Text').map((n) => n.text?.() ?? '') ?? [],
  )
}

async function count(page: Page, name: string): Promise<number> {
  return page.evaluate((n) => window.Konva?.stages[0]?.find(`.${n}`).length ?? 0, name)
}

test('the ruler measures by squares, adds waypoints with Shift, and can be shared', async ({
  page,
  context,
}) => {
  const errors = trackErrors(context)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Dirt' }).click()
  const player = await openPlayer(page)
  await page.getByTestId('dm-canvas').focus()
  await page.keyboard.press('m')

  // 6 squares east: 9 m (1 square = 1.5 m).
  const start = await screenOf(page, { x: cell(3, 5).x + 20, y: cell(3, 5).y - 10 })
  const end = await screenOf(page, cell(9, 5))
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 6 })
  await page.mouse.up()
  await expect.poll(() => texts(page)).toContain('9 m · 6 sq')
  // Not shared yet.
  expect(await count(player, 'ruler')).toBe(0)
  await page.getByRole('checkbox', { name: 'Players see the ruler' }).check()
  await expect.poll(() => texts(player)).toContain('9 m · 6 sq')

  // A new ruler with a waypoint: 3 east (Shift on release), then 4 south.
  const a = await screenOf(page, cell(3, 5))
  const b = await screenOf(page, cell(6, 5))
  const c = await screenOf(page, cell(6, 9))
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 4 })
  await page.keyboard.down('Shift')
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await page.mouse.move(c.x, c.y, { steps: 4 })
  await page.mouse.down()
  await page.mouse.up()
  await expect.poll(() => texts(page)).toContain('10.5 m · 7 sq')
  await expect.poll(() => texts(player)).toContain('10.5 m · 7 sq')

  // Esc clears it everywhere.
  await page.keyboard.press('Escape')
  await expect.poll(() => count(page, 'ruler')).toBe(0)
  await expect.poll(() => count(player, 'ruler')).toBe(0)
  expect(errors).toStrictEqual([])
})

test('templates: place a cone, see what it hits, pin it, hide it from players, delete it', async ({
  page,
  context,
}) => {
  const errors = trackErrors(context)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Dirt' }).click()
  // A goblin to hit.
  await page
    .getByRole('tabpanel')
    .getByRole('button', { name: /^Goblin/ })
    .click()
  const player = await openPlayer(page)
  await page.getByTestId('dm-canvas').focus()
  await page.keyboard.press('Escape')
  await page.keyboard.press('a')
  await page.getByRole('radio', { name: 'Cone' }).click()

  // A 15 ft cone from the intersection (12, 9) pointing west.
  const origin = await screenOf(page, { x: 12 * 70, y: 9 * 70 })
  const goblin = await page.evaluate(() => {
    const node = window.Konva?.stages[0]?.find('.item').at(-1)
    return node ? { x: node.x(), y: node.y() } : null
  })
  if (!goblin) throw new Error('goblin not placed')
  const tip = await screenOf(page, { x: 12 * 70 - 3 * 70, y: 9 * 70 })
  await page.mouse.move(origin.x, origin.y)
  await page.mouse.down()
  await page.mouse.move(tip.x, tip.y, { steps: 6 })
  await page.mouse.up()
  await expect.poll(() => texts(page)).toContain('4.5 m')
  const status = page.getByRole('region', { name: 'Area of effect tool' }).getByRole('status')
  await expect(status).toContainText('squares')
  // Players see the template while it is placed.
  await expect.poll(() => count(player, 'template-shape')).toBe(1)

  await page.keyboard.press('Enter')
  await expect(page.getByText('Area of effect template')).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Length (m)' })).toHaveValue('4.5')

  // Hidden from players: never sent.
  await page.getByRole('checkbox', { name: 'Players see it (H)' }).uncheck()
  await expect.poll(() => count(player, 'template-shape')).toBe(0)
  await page.getByTestId('dm-canvas').focus()
  await page.keyboard.press('h')
  await expect.poll(() => count(player, 'template-shape')).toBe(1)

  // Bigger from the panel, then deleted with Del.
  const length = page.getByRole('spinbutton', { name: 'Length (m)' })
  await length.fill('9')
  await length.press('Enter')
  await expect(page.getByRole('status').filter({ hasText: 'affected' })).toBeVisible()
  await page.getByTestId('dm-canvas').focus()
  await page.keyboard.press('Delete')
  await expect.poll(() => count(player, 'template-shape')).toBe(0)
  await expect.poll(() => count(page, 'template-shape')).toBe(0)
  expect(errors).toStrictEqual([])
})
