import { create } from 'zustand'

/**
 * Confirmation for destructive actions only (SPEC §8): `await confirmAction(...)`
 * resolves true when the DM confirms, false on cancel or Esc.
 */
interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  danger: boolean
  resolve: (confirmed: boolean) => void
}

export const useConfirmStore = create<{ request: ConfirmRequest | null }>()(() => ({
  request: null,
}))

export function confirmAction(options: {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
}): Promise<boolean> {
  useConfirmStore.getState().request?.resolve(false)
  return new Promise((resolve) => {
    useConfirmStore.setState({
      request: { danger: true, ...options, resolve },
    })
  })
}

export function settle(confirmed: boolean): void {
  const { request } = useConfirmStore.getState()
  if (!request) return
  useConfirmStore.setState({ request: null })
  request.resolve(confirmed)
}
