import { expect, test, type Page } from '@playwright/test'

/**
 * Milestone 2 smoke tests: the DM canvas, driven with a real mouse and keyboard.
 * Konva puts itself on `window.Konva`, which lets the tests read node positions.
 */

interface NodeInfo {
  id: string
  className: string
  x: number
  y: number
  width: number
  /** Center of the node on screen, relative to the canvas. */
  screenX: number
  screenY: number
  screenW: number
}

declare global {
  interface Window {
    Konva?: { stages: { find: (selector: string) => KonvaNode[]; scaleX: () => number }[] }
  }
}
interface KonvaNode {
  id: () => string
  getClassName: () => string
  x: () => number
  y: () => number
  width: () => number
  getClientRect: (config?: { skipStroke?: boolean; relativeTo?: unknown }) => {
    x: number
    y: number
    width: number
    height: number
  }
  getLayer: () => unknown
}

async function items(page: Page): Promise<NodeInfo[]> {
  return page.evaluate(() => {
    const stage = window.Konva?.stages[0]
    return (stage?.find('.item') ?? []).map((node) => {
      const rect = node.getClientRect()
      return {
        id: node.id(),
        className: node.getClassName(),
        x: node.x(),
        y: node.y(),
        width: node.width(),
        screenX: rect.x + rect.width / 2,
        screenY: rect.y + rect.height / 2,
        screenW: rect.width,
      }
    })
  })
}

async function tokens(page: Page): Promise<NodeInfo[]> {
  return (await items(page)).filter((node) => node.className === 'Group')
}

async function zoom(page: Page): Promise<number> {
  return page.evaluate(() => window.Konva?.stages[0]?.scaleX() ?? 1)
}

async function canvasOrigin(page: Page) {
  const box = await page.getByTestId('dm-canvas').boundingBox()
  if (!box) throw new Error('canvas not visible')
  return box
}

async function startWithMap(page: Page, errors: string[]) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('./#/dm')
  await page.getByRole('button', { name: 'Grass' }).click()
  await expect(page.getByRole('heading', { name: 'Pick a default map to start' })).toBeHidden()
}

function libraryButton(page: Page, name: string) {
  return page.getByRole('tabpanel').getByRole('button', { name: new RegExp(`^${name}`) })
}

test('picking a default map places it on the locked map layer and fits the view', async ({
  page,
}) => {
  const errors: string[] = []
  await startWithMap(page, errors)
  const [map] = await items(page)
  expect(map).toMatchObject({ className: 'Image', x: 840, y: 630, width: 1680 })
  // The whole map is in view.
  const box = await canvasOrigin(page)
  expect(map?.screenW).toBeLessThanOrEqual(box.width)
  await expect(page.getByRole('button', { name: 'Lock map layer', pressed: true })).toBeVisible()
  expect(errors).toStrictEqual([])
})

test('tokens snap while dragging, and undo/redo restores positions', async ({ page }) => {
  const errors: string[] = []
  await startWithMap(page, errors)
  await libraryButton(page, 'Goblin').click()
  await expect(page.getByRole('textbox', { name: 'Name (DM only)' })).toHaveValue('Goblin 1')
  const [goblin] = await tokens(page)
  if (!goblin) throw new Error('no token')
  expect(goblin).toMatchObject({ x: 875, y: 665 })

  const box = await canvasOrigin(page)
  const scale = await zoom(page)
  const start = { x: box.x + goblin.screenX, y: box.y + goblin.screenY }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  // About 2.2 cells right and 0.9 down: magnetic snapping lands on the cell center.
  await page.mouse.move(start.x + 20, start.y + 10, { steps: 3 })
  await page.mouse.move(start.x + 70 * 2.2 * scale, start.y + 70 * 0.9 * scale, { steps: 5 })
  await page.mouse.up()
  expect((await tokens(page))[0]).toMatchObject({ x: 1015, y: 735 })

  await page.keyboard.press('Control+z')
  expect((await tokens(page))[0]).toMatchObject({ x: 875, y: 665 })
  await page.keyboard.press('Control+Shift+z')
  expect((await tokens(page))[0]).toMatchObject({ x: 1015, y: 735 })

  // Alt disables snapping.
  const moved = (await tokens(page))[0]
  if (!moved) throw new Error('no token')
  const from = { x: box.x + moved.screenX, y: box.y + moved.screenY }
  await page.mouse.move(from.x, from.y)
  await page.keyboard.down('Alt')
  await page.mouse.down()
  await page.mouse.move(from.x + 30 * scale, from.y, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Alt')
  const free = (await tokens(page))[0]
  expect(free?.x).toBeCloseTo(1045, 0)
  expect(errors).toStrictEqual([])
})

test('keyboard: duplicate numbers tokens, arrows nudge by a cell, H hides, Del deletes', async ({
  page,
}) => {
  const errors: string[] = []
  await startWithMap(page, errors)
  await libraryButton(page, 'Wolf').click()
  const name = page.getByRole('textbox', { name: 'Name (DM only)' })
  await expect(name).toHaveValue('Wolf 1')

  // Escape in a field reverts the edit instead of committing it.
  await name.fill('Dire wolf')
  await name.press('Escape')
  await expect(name).toHaveValue('Wolf 1')
  await expect(page.getByRole('button', { name: 'Undo Place Wolf 1' })).toBeVisible()

  await page.keyboard.press('Control+d')
  await expect(name).toHaveValue('Wolf 2')
  const [, copy] = await tokens(page)
  expect(copy).toMatchObject({ x: 945, y: 735 })

  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowDown')
  expect((await tokens(page))[1]).toMatchObject({ x: 1015, y: 736 })

  await page.keyboard.press('h')
  await expect(page.getByText('Token · hidden from players')).toBeVisible()
  await page.keyboard.press('l')
  await expect(page.getByText('Token · hidden from players · locked')).toBeVisible()
  // Locked items are not deleted.
  await page.keyboard.press('Delete')
  expect(await tokens(page)).toHaveLength(2)
  await page.keyboard.press('l')
  await page.keyboard.press('Delete')
  expect(await tokens(page)).toHaveLength(1)
  await expect(page.getByRole('heading', { name: 'Grid', exact: true })).toBeVisible()
  expect(errors).toStrictEqual([])
})

test('right-click opens the item menu; box selection selects several items', async ({ page }) => {
  const errors: string[] = []
  await startWithMap(page, errors)
  await libraryButton(page, 'Ogre').click()
  await libraryButton(page, 'Hero').click()
  // z-order: the hero was placed last, so it is on top of the ogre.
  const [, hero] = await tokens(page)
  if (!hero) throw new Error('no token')
  const box = await canvasOrigin(page)

  await page.mouse.click(box.x + hero.screenX, box.y + hero.screenY, { button: 'right' })
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Edit token' })).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Hide from players' }).click()
  await expect(menu).toBeHidden()
  await expect(page.getByText('Token · hidden from players')).toBeVisible()

  // Drag a box over empty space around both tokens (the map layer is locked, so it is not picked).
  await page.mouse.move(box.x + 20, box.y + 20)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 20, box.y + box.height - 20, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByText('2 items selected')).toBeVisible()
  expect(errors).toStrictEqual([])
})

test('a token dragged together with a prop still lands on its cells', async ({ page }) => {
  const errors: string[] = []
  await startWithMap(page, errors)
  await page.getByRole('tab', { name: 'Props' }).click()
  await libraryButton(page, 'Tree').click()
  await page.getByRole('tab', { name: 'Tokens' }).click()
  await libraryButton(page, 'Wolf').click()
  const box = await canvasOrigin(page)
  const toScreen = async (x: number, y: number) =>
    page.evaluate(
      ([wx, wy]) => {
        const stage = window.Konva?.stages[0] as unknown as {
          x: () => number
          y: () => number
          scaleX: () => number
        }
        return { x: wx * stage.scaleX() + stage.x(), y: wy * stage.scaleX() + stage.y() }
      },
      [x, y] as const,
    )
  // Select both with a box, then drag by the tree (a part the wolf does not cover).
  await page.mouse.move(box.x + 10, box.y + 10)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10, { steps: 4 })
  await page.mouse.up()
  await expect(page.getByText('3 items selected')).toBeHidden()
  await expect(page.getByText('2 items selected')).toBeVisible()
  const grab = await toScreen(790, 650)
  const scale = await zoom(page)
  await page.mouse.move(box.x + grab.x, box.y + grab.y)
  await page.mouse.down()
  await page.mouse.move(box.x + grab.x + 10, box.y + grab.y, { steps: 2 })
  await page.mouse.move(box.x + grab.x + 49 * scale, box.y + grab.y, { steps: 4 })
  await page.mouse.up()
  const all = await items(page)
  expect(all.find((n) => n.className === 'Group')).toMatchObject({ x: 945, y: 665 })
  expect(all.find((n) => n.className === 'Image' && n.width === 140)).toMatchObject({
    x: 910,
    y: 630,
  })

  // Glyph tokens (with a number pip) have bounds centered on their position,
  // so rotating them with the Transformer keeps them in their cell.
  const centered = await page.evaluate(() => {
    const node = window.Konva?.stages[0]?.find('.item').find((n) => n.getClassName() === 'Group')
    if (!node) return null
    const r = node.getClientRect({ skipStroke: true, relativeTo: node.getLayer() })
    return { dx: r.x + r.width / 2 - node.x(), dy: r.y + r.height / 2 - node.y() }
  })
  expect(Math.abs(centered?.dx ?? 1)).toBeLessThan(0.01)
  expect(Math.abs(centered?.dy ?? 1)).toBeLessThan(0.01)
  expect(errors).toStrictEqual([])
})

test('calibration sets the grid from a box over N x N cells', async ({ page }) => {
  const errors: string[] = []
  await startWithMap(page, errors)
  await page.getByRole('button', { name: 'Calibrate grid to the map' }).click()
  await page.getByRole('spinbutton', { name: 'Cells per side' }).fill('2')
  const box = await canvasOrigin(page)
  const scale = await zoom(page)
  const from = { x: box.x + 200, y: box.y + 200 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 150 * scale, from.y + 150 * scale, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByRole('status')).toHaveText('Grid set to 75 px per cell')
  await expect(page.getByRole('spinbutton', { name: 'Cell size (px)' })).toHaveValue('75')
  await expect(page.getByRole('region', { name: 'Grid calibration' })).toBeHidden()
  expect(errors).toStrictEqual([])
})

test('? opens the keyboard cheat sheet and Esc closes it', async ({ page }) => {
  await page.goto('./#/dm')
  await expect(page.getByTestId('dm-canvas')).toBeVisible()
  await page.keyboard.press('Shift+?')
  const dialog = page.getByRole('dialog', { name: 'Keyboard and mouse' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Nudge by 1 cell')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})
