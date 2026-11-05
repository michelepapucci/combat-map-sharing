/** Plain geometry shapes shared by the pure modules. World px unless stated otherwise. */

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

/** Axis-aligned rectangle: top-left corner and size. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
