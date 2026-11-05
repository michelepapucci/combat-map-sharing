import type { Camera } from '../state/types'
import type { Point, Rect, Size } from './types'

/**
 * DM camera math. A Camera is the world point at the viewport center plus a zoom
 * (screen px per world px); screen coordinates are relative to the canvas'
 * top-left corner.
 */

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 8

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** Konva Stage position and scale for a camera. */
export function stageTransform(
  camera: Camera,
  viewport: Size,
): { x: number; y: number; scale: number } {
  return {
    x: viewport.width / 2 - camera.x * camera.zoom,
    y: viewport.height / 2 - camera.y * camera.zoom,
    scale: camera.zoom,
  }
}

export function screenToWorld(point: Point, camera: Camera, viewport: Size): Point {
  return {
    x: (point.x - viewport.width / 2) / camera.zoom + camera.x,
    y: (point.y - viewport.height / 2) / camera.zoom + camera.y,
  }
}

export function worldToScreen(point: Point, camera: Camera, viewport: Size): Point {
  return {
    x: (point.x - camera.x) * camera.zoom + viewport.width / 2,
    y: (point.y - camera.y) * camera.zoom + viewport.height / 2,
  }
}

/** Zooms to `zoom` (clamped) keeping the world point under `screenPoint` fixed. */
export function zoomAt(camera: Camera, viewport: Size, screenPoint: Point, zoom: number): Camera {
  const next = clampZoom(zoom)
  const anchor = screenToWorld(screenPoint, camera, viewport)
  return {
    x: anchor.x - (screenPoint.x - viewport.width / 2) / next,
    y: anchor.y - (screenPoint.y - viewport.height / 2) / next,
    zoom: next,
  }
}

/** Moves the camera so the content follows a pointer that moved by (dx, dy) screen px. */
export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { x: camera.x - dx / camera.zoom, y: camera.y - dy / camera.zoom, zoom: camera.zoom }
}

/** The world rectangle the camera shows. */
export function visibleRect(camera: Camera, viewport: Size): Rect {
  const width = viewport.width / camera.zoom
  const height = viewport.height / camera.zoom
  return { x: camera.x - width / 2, y: camera.y - height / 2, width, height }
}

/** A camera that shows the whole rectangle with `padding` screen px around it. */
export function fitRect(rect: Rect, viewport: Size, padding = 32): Camera {
  const availableW = Math.max(1, viewport.width - 2 * padding)
  const availableH = Math.max(1, viewport.height - 2 * padding)
  const zoom = clampZoom(
    Math.min(availableW / Math.max(1, rect.width), availableH / Math.max(1, rect.height)),
  )
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, zoom }
}

/** Zoom factor for a wheel event: smooth for trackpads, ~10% per mouse notch. */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  // deltaMode 1 = lines (Firefox mouse wheels), 0 = pixels.
  const px = deltaMode === 1 ? deltaY * 33 : deltaY
  return Math.exp(-Math.max(-300, Math.min(300, px)) * 0.001)
}
