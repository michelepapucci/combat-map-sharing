import { Eye, EyeOff, Lock, LockOpen } from 'lucide-react'
import type { LayerName } from '../state/types'
import { setLayerState } from '../store/actions'
import { useActiveScene } from '../store/campaign'
import { IconButton } from '../ui/controls'

/** Top of the list = top of the stack. */
const ROWS: readonly { layer: LayerName; label: string }[] = [
  { layer: 'tokens', label: 'Tokens' },
  { layer: 'props', label: 'Props' },
  { layer: 'map', label: 'Map' },
]

/** Per-layer visibility and lock (SPEC §5.3). Hidden layers are hidden from players too. */
export function LayersPanel() {
  const scene = useActiveScene()
  return (
    <div className="space-y-1.5">
      <ul className="space-y-0.5">
        {ROWS.map(({ layer, label }) => {
          const state = scene.layerState[layer]
          const count = scene.layers[layer].length
          return (
            <li
              key={layer}
              className="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-surface-2"
            >
              <span
                className={`flex-1 text-sm ${state.visible ? '' : 'text-fg-muted line-through'}`}
              >
                {label} <span className="text-xs text-fg-muted">({count})</span>
              </span>
              <IconButton
                icon={state.visible ? Eye : EyeOff}
                label={
                  state.visible
                    ? `Hide ${label.toLowerCase()} layer`
                    : `Show ${label.toLowerCase()} layer`
                }
                onClick={() => setLayerState(layer, { visible: !state.visible })}
              />
              <IconButton
                icon={state.locked ? Lock : LockOpen}
                label={`Lock ${label.toLowerCase()} layer`}
                title={
                  state.locked
                    ? `Unlock ${label.toLowerCase()} layer`
                    : `Lock ${label.toLowerCase()} layer`
                }
                pressed={state.locked}
                onClick={() => setLayerState(layer, { locked: !state.locked })}
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
