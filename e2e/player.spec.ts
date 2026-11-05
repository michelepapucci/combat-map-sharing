import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/**
 * Milestone 4: the player window renders only what projectForPlayers sends.
 * SPEC §9's done-criterion: a hidden token is absent from the player view.
 */

function trackErrors(context: BrowserContext): string[] {
  const errors: string[] = []
  context.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${msg.page()?.url() ?? '?'}: ${msg.text()}`)
  })
  context.on('weberror', (err) => errors.push(err.error().message))
  return errors
}

/** Ids of the scene items a page's canvas draws (DM or player: both name them "item"). */
async function itemIds(page: Page): Promise<string[]> {
  return page.evaluate(() => window.Konva?.stages[0]?.find('.item').map((n) => n.id()) ?? [])
}

async function pingCount(page: Page): Promise<number> {
  return page.evaluate(() => window.Konva?.stages[0]?.find('.ping').length ?? 0)
}

function libraryButton(page: Page, name: string) {
  return page.getByRole('tabpanel').getByRole('button', { name: new RegExp(`^${name}`) })
}

async function openPlayer(page: Page): Promise<Page> {
  const popup = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Open player window' }).first().click()
  const player = await popup
  await expect(page.getByText('1 window connected')).toBeVisible()
  return player
}

test('a hidden token never reaches the player window; showing it again does', async ({
  page,
  context,
}) => {
  const errors = trackErrors(context)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Grass' }).click()
  await libraryButton(page, 'Hero').click()
  await libraryButton(page, 'Goblin').click()
  const [, heroId, goblinId] = await itemIds(page)
  if (!heroId || !goblinId) throw new Error('tokens not placed')
  await page.keyboard.press('h') // the goblin is selected: hide it
  await expect(page.getByText('Token · hidden from players')).toBeVisible()

  const player = await openPlayer(page)
  await expect.poll(() => itemIds(player)).toHaveLength(2)
  const shown = await itemIds(player)
  expect(shown).toContain(heroId)
  expect(shown).not.toContain(goblinId)
  // Not even in the data the window received: nothing in its DOM or canvas mentions the goblin.
  expect(await player.content()).not.toContain('Goblin')

  await page.keyboard.press('h')
  await expect.poll(() => itemIds(player)).toContain(goblinId)
  expect(errors).toStrictEqual([])
})

test('blackout hides everything; pings show in both windows; the player notices the DM leaving', async ({
  page,
  context,
}) => {
  const errors = trackErrors(context)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Dirt' }).click()
  const player = await openPlayer(page)
  await expect.poll(() => itemIds(player)).toHaveLength(1)

  await page.getByRole('button', { name: 'Blackout', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Blackout on' })).toBeVisible()
  await expect(player.getByTestId('player-blackout')).toBeVisible()
  await page.getByRole('button', { name: 'Blackout on' }).click()
  await expect(player.getByTestId('player-blackout')).toBeHidden()
  await expect.poll(() => itemIds(player)).toHaveLength(1)

  // Alt+click pings, and the ripple shows in both windows.
  const canvas = page.getByTestId('dm-canvas')
  await page.keyboard.down('Alt')
  await canvas.click({ position: { x: 300, y: 300 } })
  await page.keyboard.up('Alt')
  await expect.poll(() => pingCount(page)).toBe(1)
  await expect.poll(() => pingCount(player)).toBe(1)
  await expect.poll(() => pingCount(player), { timeout: 4000 }).toBe(0)

  await page.close()
  await expect(player.getByText('DM window disconnected')).toBeVisible()
  // The last frame stays on screen.
  expect(await itemIds(player)).toHaveLength(1)
  expect(errors).toStrictEqual([])
})

test('the player follows the DM camera in follow mode, and a pushed view otherwise', async ({
  page,
  context,
}) => {
  const errors = trackErrors(context)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Stone floor' }).click()
  const player = await openPlayer(page)
  const playerScale = () => player.evaluate(() => window.Konva?.stages[0]?.scaleX() ?? 0)
  await expect.poll(playerScale).toBeGreaterThan(0)

  await page.getByRole('radio', { name: 'Follow my view' }).check()
  const before = await playerScale()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect.poll(playerScale).toBeGreaterThan(before * 1.3)

  // Back to pushed: the player keeps the last pushed view until the DM pushes again.
  await page.getByRole('radio', { name: 'Pushed view' }).check()
  await expect.poll(playerScale).toBeCloseTo(before, 3)
  await page.getByRole('button', { name: 'Push my view to players' }).click()
  await expect.poll(playerScale).toBeGreaterThan(before * 1.3)
  expect(errors).toStrictEqual([])
})

test('while players watch, undo never switches them to another scene', async ({
  page,
  context,
}) => {
  const errors = trackErrors(context)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Grass' }).click()
  const player = await openPlayer(page)
  const scenes = page.getByRole('navigation', { name: 'Scenes' })

  // Prepare a second scene behind blackout, then come back and lift it.
  await page.getByRole('button', { name: 'Blackout', exact: true }).click()
  await scenes.getByRole('button', { name: 'Add scene' }).click()
  await libraryButton(page, 'Goblin').click()
  await scenes.getByRole('button', { name: 'Scene 1', exact: true }).click()
  await page.getByRole('button', { name: 'Blackout on' }).click()
  await expect.poll(() => itemIds(player)).toHaveLength(1)

  // The last undo step (placing the goblin) belongs to Scene 2: refused, players keep Scene 1.
  await page.getByTestId('dm-canvas').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(page.getByText(/Undo would show players “Scene 2”/)).toBeVisible()
  await expect(scenes.getByRole('button', { name: 'Scene 1', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  expect(await itemIds(player)).toHaveLength(1)
  expect(errors).toStrictEqual([])
})
