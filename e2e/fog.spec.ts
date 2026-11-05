import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/**
 * Milestone 5: token properties and fog of war, checked in both windows.
 * Fogged enemies are never sent to the player window (CLAUDE.md, Projection rule).
 */

function trackErrors(context: BrowserContext): string[] {
  const errors: string[] = []
  context.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${msg.page()?.url() ?? '?'}: ${msg.text()}`)
  })
  context.on('weberror', (err) => errors.push(err.error().message))
  return errors
}

async function itemIds(page: Page): Promise<string[]> {
  return page.evaluate(() => window.Konva?.stages[0]?.find('.item').map((n) => n.id()) ?? [])
}

async function texts(page: Page): Promise<string[]> {
  return page.evaluate(
    () => window.Konva?.stages[0]?.find('Text').map((n) => n.text?.() ?? '') ?? [],
  )
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

/** An item's center in canvas coordinates. */
async function centerOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  const rect = await page.evaluate((itemId) => {
    const node = window.Konva?.stages[0]?.find('.item').find((n) => n.id() === itemId)
    return node ? node.getClientRect() : null
  }, id)
  if (!rect) throw new Error(`item ${id} not drawn`)
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

/**
 * Brightness (0–255) of the composited stage at a point in CSS px of the stage
 * container: every layer canvas drawn in order, as the screen shows them.
 */
async function brightness(page: Page, point: { x: number; y: number }): Promise<number> {
  return page.evaluate(({ x, y }) => {
    const stage = window.Konva?.stages[0]
    const canvases = [...(stage?.container().querySelectorAll('canvas') ?? [])]
    const first = canvases[0]
    if (!first) return -1
    const ratio = first.width / first.clientWidth
    const out = document.createElement('canvas')
    out.width = 1
    out.height = 1
    const ctx = out.getContext('2d')
    if (!ctx) return -1
    for (const canvas of canvases) {
      ctx.drawImage(canvas, Math.round(x * ratio), Math.round(y * ratio), 1, 1, 0, 0, 1, 1)
    }
    const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data
    return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
  }, point)
}

/** Moves the selected item by whole squares with the arrow keys. */
async function nudge(page: Page, key: 'ArrowLeft' | 'ArrowRight', squares: number) {
  await page.getByTestId('dm-canvas').focus()
  for (let i = 0; i < squares; i++) await page.keyboard.press(key)
}

test('token properties: label, HP bar and conditions reach players only as allowed', async ({
  page,
  context,
}) => {
  const errors = trackErrors(context)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Grass' }).click()
  await libraryButton(page, 'Goblin').click()
  const player = await openPlayer(page)
  await expect.poll(() => itemIds(player)).toHaveLength(2)

  await page.getByRole('textbox', { name: 'Label (players see it under the token)' }).fill('Sneaky')
  await page.getByRole('textbox', { name: 'Label (players see it under the token)' }).press('Enter')
  // Not shown until the DM ticks the box.
  await expect.poll(() => texts(player)).not.toContain('Sneaky')
  await page.getByRole('checkbox', { name: 'Show the label to players' }).check()
  await expect.poll(() => texts(player)).toContain('Sneaky')

  await page.getByRole('button', { name: 'Track hit points' }).click()
  await page.getByRole('button', { name: 'Lose 1 hit point' }).click()
  await expect(page.getByRole('spinbutton', { name: 'Current hit points' })).toHaveValue('9')
  await page.getByRole('combobox', { name: /Conditions/ }).fill('prone')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Prone' })).toBeVisible()
  await expect.poll(() => texts(player)).toContain('Pr')

  await page.getByRole('textbox', { name: 'DM notes (never shown to players)' }).fill('Has the key')
  await page.getByRole('textbox', { name: 'DM notes (never shown to players)' }).blur()
  // The HP numbers and the notes never reach the player window.
  const html = await player.content()
  expect(html).not.toContain('Has the key')
  expect(await texts(player)).not.toContain('9')
  expect(errors).toStrictEqual([])
})

test('fog hides enemies outside the heroes’ vision; a manual hide hides them again', async ({
  page,
  context,
}) => {
  const errors = trackErrors(context)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Stone floor' }).click()
  await libraryButton(page, 'Hero').click()
  const [, heroId] = await itemIds(page)
  await page.getByRole('spinbutton', { name: /Vision radius/ }).fill('6')
  await page.getByRole('spinbutton', { name: /Vision radius/ }).press('Enter')
  await libraryButton(page, 'Goblin').click()
  const goblinId = (await itemIds(page)).at(-1)
  await nudge(page, 'ArrowRight', 8) // far outside 6 m (4 squares)
  if (!heroId || !goblinId) throw new Error('tokens not placed')

  const player = await openPlayer(page)
  await expect.poll(() => itemIds(player)).toHaveLength(3)

  // Fog on (scene settings show with nothing selected): the goblin is out of
  // sight and is not even sent.
  await page.getByTestId('dm-canvas').focus()
  await page.keyboard.press('Escape')
  await page.getByRole('checkbox', { name: 'Fog of war on this scene' }).check()
  await expect.poll(() => itemIds(player)).toHaveLength(2)
  expect(await itemIds(player)).not.toContain(goblinId)
  expect(await player.evaluate(() => window.Konva?.stages[0]?.getLayers().length)).toBe(4)

  // It comes into view as it approaches the hero.
  await page.getByTestId('dm-canvas').click({ position: await centerOf(page, goblinId) })
  await nudge(page, 'ArrowLeft', 6)
  await expect.poll(() => itemIds(player)).toContain(goblinId)

  // A manual hide over the goblin hides it again (the Fog tool, rectangle).
  await page.keyboard.press('Escape')
  await page.keyboard.press('f')
  await page.getByRole('radio', { name: 'Hide' }).click()
  const box = await page.getByTestId('dm-canvas').boundingBox()
  if (!box) throw new Error('no canvas')
  const goblin = await page.evaluate((id) => {
    const node = window.Konva?.stages[0]?.find('.item').find((n) => n.id() === id)
    if (!node) return null
    const r = node.getClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  }, goblinId)
  if (!goblin) throw new Error('goblin not drawn')
  await page.mouse.move(box.x + goblin.x - 5, box.y + goblin.y - 5)
  await page.mouse.down()
  await page.mouse.move(box.x + goblin.x + goblin.width + 5, box.y + goblin.y + goblin.height + 5, {
    steps: 4,
  })
  await page.mouse.up()
  await expect.poll(() => itemIds(player)).not.toContain(goblinId)
  // Undo removes the manual edit.
  await page.keyboard.press('Control+z')
  await expect.poll(() => itemIds(player)).toContain(goblinId)
  expect(errors).toStrictEqual([])
})

test('preview as players shows the projection in the DM window', async ({ page, context }) => {
  const errors = trackErrors(context)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Dirt' }).click()
  await libraryButton(page, 'Wolf').click()
  await page.keyboard.press('h') // hidden from players
  await expect.poll(() => itemIds(page)).toHaveLength(2)
  await page.getByRole('button', { name: 'Preview as players' }).click()
  await expect(page.getByRole('region', { name: 'Preview as players' })).toBeVisible()
  // The DM layers are hidden; the preview draws only what players get: the map, not the wolf.
  const visible = await page.evaluate(
    () =>
      window.Konva?.stages[0]
        ?.find('.item')
        .filter((n) => n.isVisible())
        .map((n) => n.id()) ?? [],
  )
  expect(visible).toHaveLength(1)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('region', { name: 'Preview as players' })).toBeHidden()
  expect(errors).toStrictEqual([])
})

test('players see black, dimmed explored and clear visible ground; explored ground is remembered', async ({
  page,
  context,
}) => {
  const errors = trackErrors(context)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Stone floor' }).click()
  await libraryButton(page, 'Hero').click()
  const heroId = (await itemIds(page)).at(-1)
  if (!heroId) throw new Error('hero not placed')
  await page.getByRole('spinbutton', { name: /Vision radius/ }).fill('6') // 4 squares
  await page.getByRole('spinbutton', { name: /Vision radius/ }).press('Enter')
  await page.getByTestId('dm-canvas').focus()
  await page.keyboard.press('Escape')
  await page.getByRole('checkbox', { name: 'Fog of war on this scene' }).check()
  const player = await openPlayer(page)
  await expect.poll(() => itemIds(player)).toHaveLength(2)

  // Points on the player screen, in squares from the hero's starting square.
  const hero = await centerOf(player, heroId)
  const cell = await player.evaluate(() => 70 * (window.Konva?.stages[0]?.scaleX() ?? 0))
  const at = (squares: number) => ({ x: hero.x + squares * cell, y: hero.y })
  const near = at(2) // inside the vision radius
  const far = at(6) // outside it
  const behind = at(-6) // never seen

  await expect.poll(() => brightness(player, near)).toBeGreaterThan(0)
  const clear = await brightness(player, near)
  expect(await brightness(player, far)).toBe(0)
  expect(await brightness(player, behind)).toBe(0)
  // The DM sees the whole map under a light tint.
  const dmHero = await centerOf(page, heroId)
  const dmCell = await page.evaluate(() => 70 * (window.Konva?.stages[0]?.scaleX() ?? 0))
  expect(await brightness(page, { x: dmHero.x - 6 * dmCell, y: dmHero.y })).toBeGreaterThan(0)

  // The hero walks 8 squares east: the start stays explored (dimmed), the
  // destination becomes visible, the ground behind stays black.
  await page.getByTestId('dm-canvas').click({ position: dmHero })
  await nudge(page, 'ArrowRight', 8)
  // Views are throttled: wait until the player shows the hero on its last square,
  // not an intermediate step (where the start would still be in sight).
  await expect.poll(async () => (await centerOf(player, heroId)).x).toBeCloseTo(at(8).x, 0)
  await expect.poll(() => brightness(player, far)).toBeGreaterThan(0)
  await expect.poll(() => brightness(player, near)).toBeLessThan(clear * 0.8)
  const dim = await brightness(player, near)
  expect(dim).toBeGreaterThan(0)
  expect(await brightness(player, behind)).toBe(0)

  // Explored memory survives reloading the player window.
  await player.reload()
  await expect.poll(() => itemIds(player)).toHaveLength(2)
  await expect.poll(() => brightness(player, near)).toBe(dim)
  expect(errors).toStrictEqual([])
})

test('fog polygon: quick corner clicks; Enter needs three corners; a double-click closes it', async ({
  page,
  context,
}) => {
  const errors = trackErrors(context)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Dirt' }).click()
  await page.getByTestId('dm-canvas').focus()
  await page.keyboard.press('Escape')
  await page.keyboard.press('f')
  await page.getByRole('radio', { name: 'Polygon' }).click()
  const box = await page.getByTestId('dm-canvas').boundingBox()
  if (!box) throw new Error('no canvas')
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const clear = page.getByRole('button', { name: /manual fog/ })
  // Two quick clicks (inside a browser double-click window) are two corners.
  await page.mouse.click(c.x - 100, c.y - 100)
  await page.mouse.click(c.x + 100, c.y - 100)
  await page.keyboard.press('Enter') // too few corners: nothing is lost
  await page.mouse.click(c.x + 100, c.y + 100)
  await page.mouse.dblclick(c.x - 100, c.y + 100)
  await expect(clear).toHaveText('Clear manual fog (1)')
  // Backspace removes the last corner; a click on the first corner closes.
  await page.mouse.click(c.x - 50, c.y - 50)
  await page.mouse.click(c.x + 50, c.y - 50)
  await page.mouse.click(c.x + 200, c.y + 200)
  await page.keyboard.press('Backspace')
  await page.mouse.click(c.x + 50, c.y + 50)
  await page.mouse.click(c.x - 50, c.y - 50)
  await expect(clear).toHaveText('Clear manual fog (2)')
  expect(errors).toStrictEqual([])
})

test('fog tool: Backspace never deletes the selection; Alt+click pings, Alt+drag draws', async ({
  page,
  context,
}) => {
  const errors = trackErrors(context)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Dirt' }).click()
  await libraryButton(page, 'Wolf').click() // placed and selected
  await expect.poll(() => itemIds(page)).toHaveLength(2)
  await page.getByTestId('dm-canvas').focus()
  await page.keyboard.press('f')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Delete')
  expect(await itemIds(page)).toHaveLength(2)

  const box = await page.getByTestId('dm-canvas').boundingBox()
  if (!box) throw new Error('no canvas')
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const pings = () => page.evaluate(() => window.Konva?.stages[0]?.find('.ping').length ?? 0)
  await page.keyboard.down('Alt')
  await page.mouse.click(c.x + 150, c.y + 150)
  await page.keyboard.up('Alt')
  await expect.poll(pings).toBe(1)
  await page.keyboard.down('Alt')
  await page.mouse.move(c.x - 200, c.y - 200)
  await page.mouse.down()
  await page.mouse.move(c.x - 100, c.y - 120, { steps: 4 })
  await page.mouse.up()
  await page.keyboard.up('Alt')
  await page.keyboard.press('Escape') // leave the tool
  await page.keyboard.press('Escape') // clear the selection: the fog settings show
  await expect(page.getByRole('button', { name: /manual fog/ })).toHaveText('Clear manual fog (1)')
  expect(errors).toStrictEqual([])
})

test('heroes see 18 m by default; the vision section says why a token reveals nothing', async ({
  page,
  context,
}) => {
  const errors = trackErrors(context)
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Stone floor' }).click()
  await libraryButton(page, 'Hero').click()
  const heroId = (await itemIds(page)).at(-1)
  if (!heroId) throw new Error('hero not placed')
  const radius = page.getByRole('spinbutton', { name: /Vision radius/ })
  await expect(page.getByRole('checkbox', { name: 'Vision', exact: true })).toBeChecked()
  await expect(radius).toHaveValue('18')
  await expect(page.getByText('Fog is off in this scene: players see everything.')).toBeVisible()
  // The selected token's vision ring: 18 m = 12 squares of 70 px.
  const rings = () =>
    page.evaluate(
      () => window.Konva?.stages[0]?.find('Circle').filter((n) => n.radius?.() === 840).length ?? 0,
    )
  await expect.poll(rings).toBe(1)

  // Fog on: the hero alone clears its circle for players.
  await page.getByTestId('dm-canvas').focus()
  await page.keyboard.press('Escape')
  await page.getByRole('checkbox', { name: 'Fog of war on this scene' }).check()
  const player = await openPlayer(page)
  await expect.poll(() => itemIds(player)).toHaveLength(2)
  const hero = await centerOf(player, heroId)
  const cell = await player.evaluate(() => 70 * (window.Konva?.stages[0]?.scaleX() ?? 0))
  await expect
    .poll(() => brightness(player, { x: hero.x + 5 * cell, y: hero.y }))
    .toBeGreaterThan(0)

  // As an enemy it reveals nothing, and the panel says why and what to do.
  await page.getByTestId('dm-canvas').click({ position: await centerOf(page, heroId) })
  await page.getByRole('combobox', { name: 'Kind' }).selectOption('enemy')
  await expect(
    page.getByText('Enemies never reveal fog. Set Kind to Player for a hero.'),
  ).toBeVisible()
  await page.getByRole('combobox', { name: 'Kind' }).selectOption('player')
  await expect(page.getByText('Reveals fog for players.')).toBeVisible()

  // Turning vision off and on keeps the radius the DM chose.
  await radius.fill('6')
  await radius.press('Enter')
  await page.getByRole('checkbox', { name: 'Vision', exact: true }).uncheck()
  await expect(radius).toBeHidden()
  await expect(page.getByText('No vision: this hero reveals no fog.')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Vision', exact: true }).check()
  await expect(radius).toHaveValue('6')
  expect(errors).toStrictEqual([])
})
