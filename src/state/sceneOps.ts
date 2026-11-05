import { LAYER_NAMES, type Id, type Item, type LayerName, type Scene } from './types'

/** Pure helpers for reading and reordering scene items. */

export interface ItemRef {
  layer: LayerName
  index: number
  item: Item
}

/** Finds an item on any layer. */
export function findItem(scene: Scene, id: Id): ItemRef | null {
  for (const layer of LAYER_NAMES) {
    const items: Item[] = scene.layers[layer]
    const index = items.findIndex((item) => item.id === id)
    const item = items[index]
    if (item) return { layer, index, item }
  }
  return null
}

/** Every item with its layer, bottom layer first, in z-order. */
export function allItems(scene: Scene): { layer: LayerName; item: Item }[] {
  return LAYER_NAMES.flatMap((layer) => scene.layers[layer].map((item: Item) => ({ layer, item })))
}

/** Items on a layer that is visible and unlocked can be picked on the canvas. */
export function isLayerInteractive(scene: Scene, layer: LayerName): boolean {
  const state = scene.layerState[layer]
  return state.visible && !state.locked
}

/** Moving and transforming needs an unlocked item on an interactive layer. */
export function isItemMovable(scene: Scene, ref: { layer: LayerName; item: Item }): boolean {
  return !ref.item.locked && isLayerInteractive(scene, ref.layer)
}

/**
 * Moves the selected items one step up ('forward') or down ('backward') in z-order
 * within their array. Adjacent selected items move together as a block.
 */
export function moveInLayer<T extends { id: Id }>(
  items: readonly T[],
  ids: ReadonlySet<Id>,
  direction: 'forward' | 'backward',
): T[] {
  const result = [...items]
  const swap = (i: number, j: number) => {
    const a = result[i]
    const b = result[j]
    if (a === undefined || b === undefined) return
    result[i] = b
    result[j] = a
  }
  if (direction === 'forward') {
    for (let i = result.length - 2; i >= 0; i--) {
      const here = result[i]
      const above = result[i + 1]
      if (here && above && ids.has(here.id) && !ids.has(above.id)) swap(i, i + 1)
    }
  } else {
    for (let i = 1; i < result.length; i++) {
      const here = result[i]
      const below = result[i - 1]
      if (here && below && ids.has(here.id) && !ids.has(below.id)) swap(i, i - 1)
    }
  }
  return result
}
