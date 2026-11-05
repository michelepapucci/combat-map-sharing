import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutosaver, type SaveStatus } from './autosave'

const noop = () => undefined

function setup(save: (value: number) => Promise<void>) {
  const statuses: SaveStatus[] = []
  const saver = createAutosaver<number>({
    save,
    onStatus: (status) => statuses.push(status),
    delayMs: 1000,
  })
  return { saver, statuses }
}

describe('autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('saves only the latest value, one second after the last change', async () => {
    const saved: number[] = []
    const { saver, statuses } = setup(async (value) => {
      saved.push(value)
    })
    saver.schedule(1)
    await vi.advanceTimersByTimeAsync(600)
    saver.schedule(2)
    await vi.advanceTimersByTimeAsync(600)
    expect(saved).toStrictEqual([])
    await vi.advanceTimersByTimeAsync(400)
    expect(saved).toStrictEqual([2])
    expect(statuses).toStrictEqual(['pending', 'pending', 'saving', 'saved'])
  })

  it('flush saves immediately and resolves once stored', async () => {
    const saved: number[] = []
    const { saver } = setup(async (value) => {
      saved.push(value)
    })
    saver.schedule(5)
    await saver.flush()
    expect(saved).toStrictEqual([5])
    await vi.advanceTimersByTimeAsync(2000)
    expect(saved).toStrictEqual([5])
  })

  it('never runs two saves at once; a change during a save is saved after it', async () => {
    const log: string[] = []
    let finish: () => void = noop
    const { saver, statuses } = setup(
      (value) =>
        new Promise<void>((resolve) => {
          log.push(`start ${value}`)
          finish = () => {
            log.push(`end ${value}`)
            resolve()
          }
        }),
    )
    saver.schedule(1)
    await vi.advanceTimersByTimeAsync(1000)
    saver.schedule(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(log).toStrictEqual(['start 1'])
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(log).toStrictEqual(['start 1', 'end 1', 'start 2'])
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(statuses.at(-1)).toBe('saved')
  })

  it('reports errors and keeps the value for a retry', async () => {
    let fail = true
    const saved: number[] = []
    const { saver, statuses } = setup(async (value) => {
      if (fail) throw new DOMException('full', 'QuotaExceededError')
      saved.push(value)
    })
    saver.schedule(7)
    await vi.advanceTimersByTimeAsync(1000)
    expect(statuses.at(-1)).toBe('error')
    await expect(saver.flush()).rejects.toThrow('full')
    fail = false
    saver.retry()
    await vi.advanceTimersByTimeAsync(0)
    expect(saved).toStrictEqual([7])
    expect(statuses.at(-1)).toBe('saved')
  })

  it('stays in error while edits continue, until a save succeeds', async () => {
    let fail = true
    const { saver, statuses } = setup(async () => {
      if (fail) throw new Error('full')
    })
    saver.schedule(1)
    await vi.advanceTimersByTimeAsync(1000)
    saver.schedule(2)
    expect(statuses.at(-1)).toBe('error')
    fail = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(statuses.at(-1)).toBe('saved')
    saver.schedule(3)
    expect(statuses.at(-1)).toBe('pending')
  })

  it('a newer value replaces the failed one', async () => {
    const saved: number[] = []
    let fail = true
    const { saver } = setup(async (value) => {
      if (fail) throw new Error('nope')
      saved.push(value)
    })
    saver.schedule(1)
    await vi.advanceTimersByTimeAsync(1000)
    fail = false
    saver.schedule(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(saved).toStrictEqual([2])
  })

  it('dispose drops pending values', async () => {
    const saved: number[] = []
    const { saver } = setup(async (value) => {
      saved.push(value)
    })
    saver.schedule(1)
    saver.dispose()
    await vi.advanceTimersByTimeAsync(2000)
    saver.schedule(2)
    await saver.flush()
    expect(saved).toStrictEqual([])
  })
})
