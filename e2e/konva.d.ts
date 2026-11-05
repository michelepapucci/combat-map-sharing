/**
 * The slice of Konva's API the e2e tests read in the page. Konva registers
 * itself as `window.Konva`, which lets tests inspect node positions and sizes.
 */
export interface KonvaNode {
  id: () => string
  getClassName: () => string
  x: () => number
  y: () => number
  width: () => number
  height: () => number
  getClientRect: (config?: { skipStroke?: boolean; relativeTo?: unknown }) => {
    x: number
    y: number
    width: number
    height: number
  }
  getLayer: () => unknown
  isVisible: () => boolean
  /** Text nodes only. */
  text?: () => string
  /** Circle nodes only. */
  radius?: () => number
}

declare global {
  interface Window {
    Konva?: {
      stages: {
        find: (selector: string) => KonvaNode[]
        scaleX: () => number
        getLayers: () => KonvaNode[]
        /** Stage transform: world (map) px to canvas px. */
        getAbsoluteTransform: () => {
          point: (p: { x: number; y: number }) => { x: number; y: number }
        }
        container: () => HTMLDivElement
      }[]
    }
  }
}
