import { create } from 'zustand'

/**
 * Confirmation for destructive actions only (SPEC §8): `await confirmAction(...)`
 * resolves true when the DM confirms, false on cancel or Esc. `chooseAction`
 * offers several choices (for example "Replace" or "Import as a copy") and
 * resolves to the chosen id, or null on cancel or Esc.
 */
export interface Choice {
  id: string
  label: string
  tone: 'primary' | 'danger' | 'plain'
}

interface ConfirmRequest {
  title: string
  message: string
  choices: Choice[]
  resolve: (choice: string | null) => void
}

export const useConfirmStore = create<{ request: ConfirmRequest | null }>()(() => ({
  request: null,
}))

export function chooseAction(options: {
  title: string
  message: string
  choices: Choice[]
}): Promise<string | null> {
  useConfirmStore.getState().request?.resolve(null)
  return new Promise((resolve) => {
    useConfirmStore.setState({ request: { ...options, resolve } })
  })
}

export async function confirmAction(options: {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
}): Promise<boolean> {
  const choice = await chooseAction({
    title: options.title,
    message: options.message,
    choices: [
      {
        id: 'confirm',
        label: options.confirmLabel,
        tone: options.danger === false ? 'primary' : 'danger',
      },
    ],
  })
  return choice === 'confirm'
}

export function settle(choice: string | null): void {
  const { request } = useConfirmStore.getState()
  if (!request) return
  useConfirmStore.setState({ request: null })
  request.resolve(choice)
}
