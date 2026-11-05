import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/**
 * Milestone 6: the initiative tracker in the DM panel and the players' overlay.
 * Players get names only: no values, no hidden entries, no placeholders.
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

async function openPlayer(page: Page): Promise<Page> {
  const popup = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Open player window' }).click()
  const player = await popup
  await expect(page.getByText('1 window connected')).toBeVisible()
  return player
}

/** The DM's turn order: entry names top to bottom. */
async function dmOrder(page: Page): Promise<string[]> {
  const boxes = page.getByRole('list', { name: 'Turn order' }).getByRole('textbox')
  const names: string[] = []
  for (const box of await boxes.all()) names.push(await box.inputValue())
  return names
}

async function setValue(page: Page, name: string, value: number) {
  const input = page.getByRole('spinbutton', { name: `Initiative of ${name}` })
  await input.fill(String(value))
  await input.press('Enter')
}

async function pressOnCanvas(page: Page, key: string) {
  await page.getByTestId('dm-canvas').focus()
  await page.keyboard.press(key)
}

function activeRings(page: Page): Promise<number> {
  return page.evaluate(() => window.Konva?.stages[0]?.find('.active-turn').length ?? 0)
}

test('initiative: turns and rounds; players see names only, never hidden entries', async ({
  page,
  context,
}) => {
  const errors = trackErrors(context)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Stone floor' }).click()
  await libraryButton(page, 'Hero').click()
  await page.getByRole('button', { name: /^Add selected/ }).click()
  await libraryButton(page, 'Goblin').click()
  await page.getByRole('button', { name: 'Roll for selected' }).click()
  const rolled = Number(
    await page.getByRole('spinbutton', { name: 'Initiative of Goblin 1' }).inputValue(),
  )
  expect(rolled).toBeGreaterThanOrEqual(1)
  expect(rolled).toBeLessThanOrEqual(20)
  await libraryButton(page, 'Wolf').click()
  await pressOnCanvas(page, 'h') // hidden from players
  await page.getByRole('button', { name: /^Add selected/ }).click()
  await setValue(page, 'Hero 1', 15)
  await setValue(page, 'Goblin 1', 12)
  expect(await dmOrder(page)).toStrictEqual(['Hero 1', 'Goblin 1', 'Wolf 1'])

  const player = await openPlayer(page)
  const overlay = player.getByRole('complementary', { name: 'Initiative' })
  await expect(overlay).toBeHidden() // the tracker is not shown yet
  await page.getByRole('checkbox', { name: 'Show tracker to players' }).check()
  await expect(overlay.getByRole('listitem')).toHaveText(['Hero 1', 'Goblin 1'])
  await expect(overlay).not.toContainText('15')
  await expect(overlay).not.toContainText('12')

  // N starts combat; the active token pulses in both windows.
  await pressOnCanvas(page, 'n')
  await expect(overlay.locator('[aria-current="step"]')).toHaveText(/Hero 1$/)
  await expect.poll(() => activeRings(player)).toBe(1)
  await expect.poll(() => activeRings(page)).toBe(1)
  await pressOnCanvas(page, 'n')
  await expect(overlay.locator('[aria-current="step"]')).toHaveText(/Goblin 1$/)
  // The hidden wolf's turn: players keep seeing the goblin's turn (no gap that
  // would give the wolf away); the DM's ring is on the wolf.
  await pressOnCanvas(page, 'n')
  await expect(
    page.getByRole('list', { name: 'Turn order' }).locator('[aria-current="step"]'),
  ).toHaveCount(1)
  await expect(
    page
      .getByRole('list', { name: 'Turn order' })
      .locator('[aria-current="step"]')
      .getByRole('textbox'),
  ).toHaveValue('Wolf 1')
  await expect(overlay.locator('[aria-current="step"]')).toHaveText(/Goblin 1$/)
  await expect.poll(() => activeRings(player)).toBe(1)
  await expect.poll(() => activeRings(page)).toBe(1)
  // A new round after the last entry; Shift+N goes back.
  await pressOnCanvas(page, 'n')
  await expect(overlay).toContainText('Round 2')
  await expect(overlay.locator('[aria-current="step"]')).toHaveText(/Hero 1$/)
  await pressOnCanvas(page, 'Shift+N')
  await expect(overlay).toContainText('Round 1')

  // The wolf's entry can be shown on its own, though the token stays hidden.
  await page.getByRole('button', { name: 'Show Wolf 1 to players' }).click()
  await expect(overlay.getByRole('listitem')).toHaveText([/Hero 1$/, /Goblin 1$/, /Wolf 1$/])
  await expect
    .poll(() => player.evaluate(() => window.Konva?.stages[0]?.find('.item').length))
    .toBe(3)

  // End combat asks first, then clears the tracker everywhere.
  await page.getByRole('button', { name: 'End combat…' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'End combat' }).click()
  await expect(page.getByRole('list', { name: 'Turn order' })).toBeHidden()
  await expect(overlay).toBeHidden()
  expect(errors).toStrictEqual([])
})

test('initiative: add by name and from the item menu; ties reorder by drag or keys', async ({
  page,
  context,
}) => {
  const errors = trackErrors(context)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Dirt' }).click()
  await libraryButton(page, 'Bandit').click()
  const box = await page.getByTestId('dm-canvas').boundingBox()
  if (!box) throw new Error('no canvas')
  const bandit = await page.evaluate(() => {
    const node = window.Konva?.stages[0]?.find('.item').at(-1)
    const r = node?.getClientRect()
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
  })
  if (!bandit) throw new Error('bandit not drawn')
  await page.mouse.click(box.x + bandit.x, box.y + bandit.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Add to initiative' }).click()
  await setValue(page, 'Bandit 1', 12)

  const name = page.getByRole('textbox', { name: 'Name of a creature to add' })
  const init = page.getByRole('spinbutton', { name: 'Its initiative' })
  for (const [who, value] of [
    ['Lair action', '20'],
    ['Thug', '12'],
  ] as const) {
    await name.fill(who)
    await init.fill(value)
    await page.getByRole('button', { name: 'Add to initiative', exact: true }).click()
  }
  expect(await dmOrder(page)).toStrictEqual(['Lair action', 'Bandit 1', 'Thug'])
  // Exact ties (same value, no tiebreak) are ordered by hand.
  await page
    .getByRole('button', { name: 'Reorder Thug among tied entries' })
    .dragTo(page.getByRole('list', { name: 'Turn order' }).getByRole('listitem').nth(1))
  expect(await dmOrder(page)).toStrictEqual(['Lair action', 'Thug', 'Bandit 1'])
  await page.getByRole('button', { name: 'Reorder Thug among tied entries' }).press('ArrowDown')
  expect(await dmOrder(page)).toStrictEqual(['Lair action', 'Bandit 1', 'Thug'])
  // A dex tiebreak decides before the manual order.
  const dex = page.getByRole('spinbutton', { name: 'Dex tiebreak of Thug' })
  await dex.fill('3')
  await dex.press('Enter')
  expect(await dmOrder(page)).toStrictEqual(['Lair action', 'Thug', 'Bandit 1'])
  // An empty name is refused: the field shows the kept name again.
  const thug = page.getByRole('textbox', { name: 'Name players see for Thug' })
  await thug.fill('')
  await thug.press('Enter')
  await expect(thug).toHaveValue('Thug')
  expect(errors).toStrictEqual([])
})
