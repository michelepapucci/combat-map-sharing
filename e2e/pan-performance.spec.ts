import { expect, test, type Page } from '@playwright/test'

/**
 * SPEC §8 performance target: "60 fps panning with an 8k map plus 50 tokens".
 * A benchmark, not a smoke test: it builds an 8192 × 8192 map in the page and
 * places 50 tokens, which takes a minute, so it only runs with `npm run bench`
 * (PERF=1). It prints the frame statistics and fails below 50 fps on average.
 * Headless Chromium rasterizes in software, so a real GPU does at least as well.
 */

test.skip(!process.env.PERF, 'benchmark: run with npm run bench')
test.setTimeout(300_000)

async function dropBigMap(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(8192, 8192)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    const gradient = ctx.createLinearGradient(0, 0, 8192, 8192)
    gradient.addColorStop(0, '#335533')
    gradient.addColorStop(1, '#553333')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 8192, 8192)
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = `hsl(${(i * 37) % 360} 40% 40%)`
      ctx.fillRect((i * 997) % 8192, (i * 613) % 8192, 60, 60)
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    const transfer = new DataTransfer()
    transfer.items.add(new File([blob], 'big-map.png', { type: 'image/png' }))
    const target = document.querySelector('[data-testid="dm-canvas"]')
    if (!target) throw new Error('no canvas')
    const rect = target.getBoundingClientRect()
    for (const type of ['dragover', 'drop']) {
      target.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientX: rect.x + rect.width / 2,
          clientY: rect.y + rect.height / 2,
        }),
      )
    }
  })
  await page.waitForFunction(
    () => (window.Konva?.stages[0]?.find('Image').filter((n) => n.width() > 4000).length ?? 0) > 0,
    null,
    { timeout: 120_000 },
  )
}

/** Pans for 3 s with the middle button; frame gaps from requestAnimationFrame. */
async function measurePan(page: Page): Promise<{ fps: number; p95: number; slow: number }> {
  const box = await page.getByTestId('dm-canvas').boundingBox()
  if (!box) throw new Error('no canvas')
  await page.evaluate(() => {
    const w = window as unknown as { benchFrames: number[]; benchRaf: number }
    w.benchFrames = []
    const loop = (t: number) => {
      w.benchFrames.push(t)
      w.benchRaf = requestAnimationFrame(loop)
    }
    w.benchRaf = requestAnimationFrame(loop)
  })
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down({ button: 'middle' })
  const started = Date.now()
  for (let i = 0; Date.now() - started < 3000; i++) {
    await page.mouse.move(cx + Math.sin(i / 10) * 300, cy + Math.cos(i / 13) * 200)
  }
  await page.mouse.up({ button: 'middle' })
  const frames = await page.evaluate(() => {
    const w = window as unknown as { benchFrames: number[]; benchRaf: number }
    cancelAnimationFrame(w.benchRaf)
    return w.benchFrames
  })
  const gaps = frames
    .slice(1)
    .map((t, k) => t - (frames[k] ?? t))
    .toSorted((a, b) => a - b)
  const average = gaps.reduce((a, b) => a + b, 0) / gaps.length
  return {
    fps: 1000 / average,
    p95: gaps[Math.floor(gaps.length * 0.95)] ?? 0,
    slow: gaps.filter((gap) => gap > 33).length,
  }
}

test('panning an 8k map with 50 tokens stays near 60 fps, with a player window following', async ({
  page,
}) => {
  await page.goto('./#/dm')
  await dropBigMap(page)
  const goblin = page.getByRole('tabpanel').getByRole('button', { name: /^Goblin/ })
  for (let i = 0; i < 50; i++) {
    await goblin.click()
    await page.getByTestId('dm-canvas').focus()
    for (let k = 0; k < i % 10; k++) await page.keyboard.press('ArrowRight')
    for (let k = 0; k < Math.floor(i / 10); k++) await page.keyboard.press('ArrowDown')
  }
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Fit everything in view' }).click()

  const alone = await measurePan(page)
  const popup = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Open player window' }).click()
  await popup
  await expect(page.getByText('1 window connected')).toBeVisible()
  await page.getByRole('radio', { name: 'Follow my view' }).check()
  const following = await measurePan(page)
  console.log(
    `DM alone: ${alone.fps.toFixed(1)} fps, p95 ${alone.p95.toFixed(1)} ms, ${alone.slow} slow frames\n` +
      `With a player window following: ${following.fps.toFixed(1)} fps, p95 ${following.p95.toFixed(1)} ms, ${following.slow} slow frames`,
  )
  expect(alone.fps).toBeGreaterThan(50)
  expect(following.fps).toBeGreaterThan(50)
})
