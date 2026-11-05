import { ArrowLeft, ArrowRight, Copy, Ellipsis, Pencil, Plus, Trash } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Id } from '../state/types'
import { useCampaignStore } from '../store/campaign'
import {
  addScene,
  deleteScene,
  duplicateScene,
  MAX_SCENE_NAME,
  moveScene,
  renameScene,
  switchScene,
} from '../store/sceneActions'
import { Menu } from '../ui/Menu'
import { confirmAction } from './confirm'

/** Scene ids and names as one string, so the selector returns a primitive (no re-render loops). */
function useSceneList(): { id: Id; name: string }[] {
  const encoded = useCampaignStore((s) =>
    JSON.stringify(s.campaign?.scenes.map((scene) => [scene.id, scene.name]) ?? []),
  )
  return (JSON.parse(encoded) as [Id, string][]).map(([id, name]) => ({ id, name }))
}

/** Asks, then deletes (calling `beforeDelete` first). */
async function askDelete(id: Id, name: string, beforeDelete: () => void): Promise<void> {
  const confirmed = await confirmAction({
    title: 'Delete scene?',
    message: `“${name}” and everything on it (tokens, props, fog, initiative) will be deleted. Undo brings it back.`,
    confirmLabel: 'Delete scene',
  })
  if (!confirmed) return
  beforeDelete()
  deleteScene(id)
}

function RenameInput({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [draft, setDraft] = useState(name)
  const done = useRef(false)
  const finish = (value: string | null) => {
    if (done.current) return
    done.current = true
    onDone(value)
  }
  return (
    <input
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- the DM just asked to rename this scene
      autoFocus
      aria-label="Scene name"
      value={draft}
      maxLength={MAX_SCENE_NAME}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(draft)}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') finish(draft)
        if (event.key === 'Escape') {
          event.preventDefault()
          finish(null)
        }
      }}
      className="h-7 w-40 rounded-md border border-accent bg-surface-2 px-2 text-sm text-fg"
    />
  )
}

/**
 * Scene tabs above the canvas (SPEC §5.10): click to switch, double-click to
 * rename, the ⋯ menu of the active scene to rename, duplicate, move or delete.
 * The tab row scrolls sideways (mouse wheel too) and keeps the active tab in
 * view; after a scene action the keyboard focus lands on the active tab.
 */
export function SceneBar() {
  const scenes = useSceneList()
  const activeId = useCampaignStore((s) => s.campaign?.activeSceneId ?? null)
  const [renaming, setRenaming] = useState<Id | null>(null)
  const [menu, setMenu] = useState<{ id: Id; button: HTMLElement } | null>(null)
  const tabs = useRef(new Map<Id, HTMLButtonElement>())
  /** Set by scene actions: move focus to the active tab once the bar has re-rendered. */
  const focusActive = useRef(false)
  // The active tab's position: the effect re-runs when it moves.
  const activeIndex = scenes.findIndex((scene) => scene.id === activeId)

  useEffect(() => {
    if (renaming !== null || activeId === null || activeIndex < 0) return
    const tab = tabs.current.get(activeId)
    tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    if (focusActive.current) {
      focusActive.current = false
      tab?.focus()
    }
  }, [activeId, renaming, activeIndex])

  const closeMenu = useCallback(
    (refocus: boolean) => {
      if (refocus) menu?.button.focus()
      setMenu(null)
    },
    [menu],
  )

  /** Runs a scene action, then focuses the (possibly new) active tab. */
  const act = (run: () => void) => () => {
    focusActive.current = true
    run()
  }

  const index = menu ? scenes.findIndex((scene) => scene.id === menu.id) : -1
  const menuScene = scenes[index]

  return (
    <nav
      aria-label="Scenes"
      className="flex h-10 items-center gap-1 border-b border-border bg-surface px-2"
    >
      <div
        className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:thin]"
        onWheel={(event) => {
          // A vertical wheel scrolls the tabs sideways.
          if (event.deltaX === 0 && event.deltaY !== 0)
            event.currentTarget.scrollLeft += event.deltaY
        }}
      >
        {scenes.map((scene) => {
          const active = scene.id === activeId
          if (renaming === scene.id) {
            return (
              <RenameInput
                key={scene.id}
                name={scene.name}
                onDone={(name) => {
                  focusActive.current = true
                  setRenaming(null)
                  if (name !== null && name.trim() !== scene.name) renameScene(scene.id, name)
                }}
              />
            )
          }
          return (
            <div
              key={scene.id}
              className={`flex shrink-0 items-center rounded-md ${active ? 'bg-surface-3' : ''}`}
            >
              <button
                ref={(element) => {
                  if (element) tabs.current.set(scene.id, element)
                  else tabs.current.delete(scene.id)
                }}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => switchScene(scene.id)}
                onDoubleClick={() => setRenaming(scene.id)}
                title={active ? 'Double-click to rename' : `Switch to ${scene.name}`}
                className={`max-w-48 truncate rounded-md px-2.5 py-1 text-sm ${active ? 'font-medium text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg'}`}
              >
                {scene.name}
              </button>
              {active && (
                <button
                  type="button"
                  aria-label={`Actions for scene ${scene.name}`}
                  aria-haspopup="menu"
                  aria-expanded={menu?.id === scene.id}
                  title="Scene actions: rename, duplicate, move, delete"
                  onClick={(event) => {
                    const button = event.currentTarget
                    setMenu(menu ? null : { id: scene.id, button })
                  }}
                  className="mr-0.5 rounded p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
                >
                  <Ellipsis aria-hidden className="size-4" />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <button
        type="button"
        onClick={act(() => addScene())}
        aria-label="Add scene"
        title="Add scene"
        className="shrink-0 rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
      >
        <Plus aria-hidden className="size-4" />
      </button>
      {menu && menuScene && (
        <Menu
          anchor={menu.button}
          label={`Actions for scene ${menuScene.name}`}
          onClose={closeMenu}
          items={[
            { label: 'Rename', icon: Pencil, run: () => setRenaming(menuScene.id) },
            {
              label: 'Duplicate',
              icon: Copy,
              run: act(() => duplicateScene(menuScene.id)),
            },
            {
              label: 'Move left',
              icon: ArrowLeft,
              disabled: index === 0,
              run: act(() => moveScene(menuScene.id, -1)),
            },
            {
              label: 'Move right',
              icon: ArrowRight,
              disabled: index === scenes.length - 1,
              run: act(() => moveScene(menuScene.id, 1)),
            },
            {
              label: 'Delete',
              icon: Trash,
              danger: true,
              disabled: scenes.length === 1,
              hint: scenes.length === 1 ? 'A campaign needs at least one scene' : undefined,
              run: () => {
                void askDelete(menuScene.id, menuScene.name, () => {
                  focusActive.current = true
                })
              },
            },
          ]}
        />
      )}
    </nav>
  )
}
