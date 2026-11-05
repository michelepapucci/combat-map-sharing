import type { Point } from '../../geometry/types'

/**
 * The pointer's last world position over the DM canvas (null when it is
 * outside). Read by keyboard paste to drop copies under the pointer.
 */
let lastPointerWorld: Point | null = null

export function setPointerWorld(point: Point | null): void {
  lastPointerWorld = point
}

export function getPointerWorld(): Point | null {
  return lastPointerWorld
}
