import { ROUTE_HASH } from './route'

export function NotFound({ path }: { path: string }) {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">Nothing at “#{path}”</h1>
      <nav aria-label="Views" className="flex gap-3">
        <a className="rounded-md bg-surface-2 px-3 py-2 hover:bg-surface-3" href={ROUTE_HASH.dm}>
          DM view
        </a>
        <a
          className="rounded-md bg-surface-2 px-3 py-2 hover:bg-surface-3"
          href={ROUTE_HASH.player}
        >
          Player view
        </a>
      </nav>
    </main>
  )
}
