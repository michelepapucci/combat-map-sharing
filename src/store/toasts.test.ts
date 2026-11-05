import { beforeEach, describe, expect, it } from 'vitest'
import { dismissToast, initialUiState, MAX_TOASTS, notify, notifySticky, useUiStore } from './ui'

const toasts = () => useUiStore.getState().toasts

beforeEach(() => {
  useUiStore.setState(initialUiState())
})

describe('toasts', () => {
  it('stack messages with their kind; repeats are counted, not stacked', () => {
    notify('Saved in this browser.', 'success')
    notify('Saved in this browser.', 'success')
    notifySticky(['Saving failed.'], 'error')
    expect(toasts().map((t) => [t.lines[0], t.kind, t.sticky, t.count])).toStrictEqual([
      ['Saved in this browser.', 'success', false, 2],
      ['Saving failed.', 'error', true, 1],
    ])
  })

  it(`keep at most ${MAX_TOASTS}, dropping fading ones before sticky ones`, () => {
    notifySticky(['Keep me.'])
    for (let i = 0; i < 6; i++) notify(`Message ${i}`)
    expect(toasts()).toHaveLength(MAX_TOASTS)
    expect(toasts()[0]?.lines).toStrictEqual(['Keep me.'])
    expect(toasts().at(-1)?.lines).toStrictEqual(['Message 5'])
  })

  it('show a new message even when every older one is sticky', () => {
    for (let i = 0; i < MAX_TOASTS; i++) notifySticky([`Problem ${i}`])
    notify('Player window disconnected.', 'warning')
    expect(toasts().map((t) => t.lines[0])).toStrictEqual([
      ...Array.from({ length: MAX_TOASTS - 1 }, (_, i) => `Problem ${i + 1}`),
      'Player window disconnected.',
    ])
  })

  it('are dismissed one by one', () => {
    notify('One')
    notify('Two')
    const first = toasts()[0]
    dismissToast(first?.id ?? -1)
    expect(toasts().map((t) => t.lines[0])).toStrictEqual(['Two'])
  })
})
