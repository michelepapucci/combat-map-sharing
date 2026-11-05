import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Group, Layer, Stage } from 'react-konva'
import { GridShape } from '../../canvas/GridShape'
import { useDevicePixelRatio } from '../../canvas/useDevicePixelRatio'
import {
  fitRect,
  panBy,
  screenToWorld,
  stageTransform,
  visibleRect,
  wheelZoomFactor,
  zoomAt,
} from '../../geometry/camera'
import { snapTemplateOrigin, templateFromDrag, type AoeGrid } from '../../geometry/aoe'
import { nearestLine } from '../../geometry/grid'
import { snapRulerPoint } from '../../geometry/ruler'
import { itemBounds, rectFromPoints, rectsIntersect } from '../../geometry/rect'
import { rotatedExtent, SNAP_THRESHOLD, snapCenter, tokenSpan } from '../../geometry/snap'
import type { Point, Rect, Size } from '../../geometry/types'
import { allItems, findItem, isItemMovable, isLayerInteractive } from '../../state/sceneOps'
import { newId } from '../../state/ids'
import type { AoeShape, AoeTemplate, Id, Token } from '../../state/types'
import {
  calibrateGrid,
  contentBounds,
  currentScene,
  moveItems,
  movableIds,
} from '../../store/actions'
import { getCampaign, useActiveScene } from '../../store/campaign'
import { addFogEdit, flatPoints } from '../../store/fogActions'
import {
  cleanTemplateFeet,
  findTemplate,
  moveTemplates,
  selectedTemplateIds,
} from '../../store/templateActions'
import { notify, setSelection, setTool, useUiStore } from '../../store/ui'
import { LIBRARY_MIME, parseLibraryEntry, placeLibraryEntry } from '../placement'
import { closeFogPolygon } from '../fogTool'
import { ping } from '../presentation'
import { importAndPlace } from '../uploads'
import { Annotations } from './Annotations'
import { CanvasHud } from './CanvasHud'
import { DmFogTint, PlayersPreview } from './FogViews'
import { Overlay } from './Overlay'
import { setPointerWorld } from './pointer'
import { DmItems, DmTokens } from './SceneLayers'

/** Pointer travel (screen px) before a press becomes a drag instead of a click. */
const DRAG_THRESHOLD = 4

type Gesture =
  | { kind: 'pan'; pointerId: number; button: number; start: Point; last: Point }
  | {
      kind: 'drag'
      pointerId: number
      startScreen: Point
      startWorld: Point
      primaryId: Id
      /** The item whose footprint is snapped: a token if the selection has one (Decision 48). */
      snapId: Id
      origins: Record<Id, Point>
      footprint: Size
      /** Tokens always snap to cells; props snap magnetically (Decision 48). */
      snapThreshold: number
      moved: boolean
      /** Clicking (without moving) an item of a multi-selection selects just it. */
      selectOnlyOnClick: boolean
    }
  | {
      kind: 'marquee'
      pointerId: number
      startScreen: Point
      startWorld: Point
      additive: boolean
      moved: boolean
    }
  | { kind: 'calibrate'; pointerId: number; startScreen: Point; startWorld: Point; moved: boolean }
  | {
      kind: 'fogRect'
      pointerId: number
      startScreen: Point
      startWorld: Point
      moved: boolean
      /** Corners snap to grid lines (snapping on, Alt not held at the start). */
      snap: boolean
      /** Alt was held: a click without a drag pings, like Alt+click with other tools. */
      alt: boolean
      /** The scene the shape is drawn in; it is dropped if the scene changed meanwhile. */
      sceneId: Id
    }
  | { kind: 'fogBrush'; pointerId: number; radius: number; points: Point[]; sceneId: Id }
  | {
      kind: 'measure'
      pointerId: number
      startScreen: Point
      /** The new ruler's first point (unused when continuing one). */
      start: Point
      moved: boolean
      /** The press continued a ruler whose end was following the pointer (after a waypoint). */
      continued: boolean
      alt: boolean
    }
  | {
      kind: 'aoePlace'
      pointerId: number
      startScreen: Point
      origin: Point
      /** Nothing is placed (nor sent to players) until the pointer moves. */
      moved: boolean
      alt: boolean
    }
  | {
      kind: 'templateDrag'
      pointerId: number
      startScreen: Point
      startWorld: Point
      primaryId: Id
      origins: Record<Id, Point>
      moved: boolean
    }

/** The id of the scene item a Konva event hit, if any. */
function itemIdOf(target: Konva.Node): Id | null {
  const node = target.hasName('item') ? target : target.findAncestor('.item')
  return node ? node.id() : null
}

/** The id of the pinned template whose outline or origin handle a Konva event hit, if any. */
function templateIdOf(target: Konva.Node): Id | null {
  return target.hasName('template') ? target.id() : null
}

/** The scene's grid as the template geometry wants it. */
function aoeGrid(): AoeGrid {
  const { size, offsetX, offsetY, feetPerCell } = currentScene().grid
  return { size, offsetX, offsetY, feetPerCell }
}

/** A ruler point: the cell center under the pointer, or the pointer itself (Alt, or snapping off). */
function rulerPoint(world: Point, free: boolean): Point {
  return free || !getCampaign().settings.snapEnabled
    ? world
    : snapRulerPoint(world, currentScene().grid)
}

/** Replaces the ruler's live end. */
function setRulerEnd(point: Point): void {
  const { measurement } = useUiStore.getState()
  if (!measurement || measurement.points.length === 0) return
  useUiStore.setState({ measurement: { points: [...measurement.points.slice(0, -1), point] } })
}

/** A new template of the tool's options at `origin`, the size of the last one placed. */
function newTempTemplate(origin: Point, direction: number | undefined): AoeTemplate {
  const ui = useUiStore.getState()
  const directionDeg = direction ?? (ui.aoeShape === 'cube' ? 45 : 0)
  return {
    id: newId(),
    shape: ui.aoeShape,
    originX: origin.x,
    originY: origin.y,
    sizeFt: ui.aoeLastSizeFt,
    widthFt: ui.aoeLineWidthFt,
    directionDeg:
      ui.aoeShape === 'cube'
        ? (Math.round((directionDeg - 45) / 90) * 90 + 45 + 360) % 360
        : directionDeg,
    color: ui.aoeColor,
    visibleToPlayers: ui.aoeVisibleToPlayers,
  }
}

/** Direction snapping while dragging out a template (cubes stay axis-aligned unless Alt). */
function templateSnap(
  shape: AoeShape,
  event: PointerEvent,
): { snapDegrees: number | null; snapOffsetDeg?: number } {
  if (shape === 'cube')
    return event.altKey ? { snapDegrees: null } : { snapDegrees: 90, snapOffsetDeg: 45 }
  if (shape === 'cone' || shape === 'line') return { snapDegrees: event.shiftKey ? 15 : null }
  return { snapDegrees: null }
}

function isTransformerPart(target: Konva.Node): boolean {
  // findAncestor returns undefined (not null) when nothing matches.
  return Boolean(target.findAncestor('Transformer'))
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * When a right-button pan ended (ms). On Windows the contextmenu event fires on
 * release, after the pan, and must not open the item menu.
 */
let rightPanEndedAt = -Infinity

function onContextMenu(e: KonvaEventObject<PointerEvent>): void {
  e.evt.preventDefault()
  if (performance.now() - rightPanEndedAt < 500) return
  const id = useUiStore.getState().tool === 'select' ? itemIdOf(e.target) : null
  if (id === null) {
    useUiStore.setState({ contextMenu: null })
    return
  }
  if (!useUiStore.getState().selection.includes(id)) setSelection([id])
  useUiStore.setState({ contextMenu: { x: e.evt.clientX, y: e.evt.clientY } })
}

function onDragOver(event: DragEvent): void {
  const types = event.dataTransfer.types
  if (types.includes(LIBRARY_MIME) || types.includes('Files')) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }
}

/**
 * The DM canvas: a Konva stage with the map layer, the content layer (grid,
 * props, tokens) and the overlay. Handles pan/zoom, selection, dragging with
 * snapping, the marquee, grid calibration and drops from the library.
 */
export function DmCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [calibration, setCalibration] = useState<Rect | null>(null)
  const [panning, setPanning] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const spaceRef = useRef(false)

  const scene = useActiveScene()
  const camera = useUiStore((s) => s.dmCamera)
  const viewport = useUiStore((s) => s.dmViewport)
  const tool = useUiStore((s) => s.tool)
  const dragging = useUiStore((s) => s.liveDrag !== null)
  const hoveredId = useUiStore((s) => s.hoveredId)
  const fitPending = useUiStore((s) => s.fitPending)
  const preview = useUiStore((s) => s.previewAsPlayers)
  const dpr = useDevicePixelRatio()

  // A newly opened campaign or scene (without a remembered view) is fitted once the size is known.
  useEffect(() => {
    if (!fitPending || viewport.width === 0 || viewport.height === 0) return
    const bounds = contentBounds(scene)
    useUiStore.setState({
      fitPending: false,
      dmCamera: bounds ? fitRect(bounds, viewport) : { x: 0, y: 0, zoom: 1 },
    })
  }, [fitPending, viewport, scene])

  // Track the canvas size.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      useUiStore.setState({ dmViewport: { width: Math.round(width), height: Math.round(height) } })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Pointer moves and releases are tracked on the window, so gestures continue outside the canvas.
  useEffect(() => {
    const screenPoint = (event: PointerEvent): Point => {
      const rect = containerRef.current?.getBoundingClientRect()
      return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
    }

    const onMove = (event: PointerEvent) => {
      const gesture = gestureRef.current
      if (!gesture || event.pointerId !== gesture.pointerId) return
      const point = screenPoint(event)
      const { dmCamera, dmViewport } = useUiStore.getState()
      const world = screenToWorld(point, dmCamera, dmViewport)
      switch (gesture.kind) {
        case 'pan': {
          useUiStore.setState({
            dmCamera: panBy(dmCamera, point.x - gesture.last.x, point.y - gesture.last.y),
          })
          gesture.last = point
          break
        }
        case 'drag': {
          if (!gesture.moved && distance(point, gesture.startScreen) < DRAG_THRESHOLD) return
          gesture.moved = true
          let dx = world.x - gesture.startWorld.x
          let dy = world.y - gesture.startWorld.y
          const origin = gesture.origins[gesture.snapId]
          if (origin && getCampaign().settings.snapEnabled && !event.altKey) {
            const snapped = snapCenter(
              { x: origin.x + dx, y: origin.y + dy },
              gesture.footprint,
              currentScene().grid,
              gesture.snapThreshold,
            )
            dx = snapped.x - origin.x
            dy = snapped.y - origin.y
          }
          const liveDrag: Record<Id, Point> = {}
          for (const [id, o] of Object.entries(gesture.origins))
            liveDrag[id] = { x: o.x + dx, y: o.y + dy }
          useUiStore.setState({ liveDrag, dragPrimaryId: gesture.primaryId, hoveredId: null })
          break
        }
        case 'fogRect': {
          if (!gesture.moved && distance(point, gesture.startScreen) < DRAG_THRESHOLD) return
          gesture.moved = true
          const { grid } = currentScene()
          const to =
            gesture.snap && !event.altKey
              ? {
                  x: nearestLine(world.x, grid.offsetX, grid.size),
                  y: nearestLine(world.y, grid.offsetY, grid.size),
                }
              : world
          useUiStore.setState({ fogDraft: { type: 'rect', from: gesture.startWorld, to } })
          break
        }
        case 'fogBrush': {
          const last = gesture.points.at(-1)
          if (last && distance(last, world) < gesture.radius / 3) return
          gesture.points.push(world)
          useUiStore.setState({
            fogDraft: { type: 'brush', points: [...gesture.points], radius: gesture.radius },
          })
          break
        }
        case 'measure': {
          const end = rulerPoint(world, event.altKey)
          if (!gesture.moved) {
            if (distance(point, gesture.startScreen) < DRAG_THRESHOLD) {
              if (gesture.continued) setRulerEnd(end)
              return
            }
            gesture.moved = true
            // A new ruler appears (and reaches players) only once the drag starts.
            if (!gesture.continued) {
              useUiStore.setState({
                measurement: { points: [gesture.start, end] },
                measuring: 'drag',
              })
            }
          }
          setRulerEnd(end)
          break
        }
        case 'aoePlace': {
          if (!gesture.moved && distance(point, gesture.startScreen) < DRAG_THRESHOLD) return
          const ui = useUiStore.getState()
          // The first move replaces any unpinned template with a new one.
          const temp: AoeTemplate =
            gesture.moved && ui.tempTemplate
              ? ui.tempTemplate
              : newTempTemplate(gesture.origin, ui.tempTemplate?.directionDeg)
          gesture.moved = true
          const { sizeFt, directionDeg } = templateFromDrag(
            temp.shape,
            gesture.origin,
            world,
            aoeGrid(),
            {
              ...templateSnap(temp.shape, event),
              fallbackDirectionDeg: temp.directionDeg,
            },
          )
          useUiStore.setState({
            tempTemplate: { ...temp, sizeFt: cleanTemplateFeet(sizeFt), directionDeg },
          })
          break
        }
        case 'templateDrag': {
          if (!gesture.moved && distance(point, gesture.startScreen) < DRAG_THRESHOLD) return
          gesture.moved = true
          const primary = gesture.origins[gesture.primaryId]
          const template = findTemplate(currentScene(), gesture.primaryId)
          if (!primary || !template) return
          let target = {
            x: primary.x + world.x - gesture.startWorld.x,
            y: primary.y + world.y - gesture.startWorld.y,
          }
          if (getCampaign().settings.snapEnabled && !event.altKey) {
            target = snapTemplateOrigin(template.shape, target, aoeGrid())
          }
          const dx = target.x - primary.x
          const dy = target.y - primary.y
          const liveDrag: Record<Id, Point> = {}
          for (const [id, o] of Object.entries(gesture.origins))
            liveDrag[id] = { x: o.x + dx, y: o.y + dy }
          useUiStore.setState({ liveDrag })
          break
        }
        case 'marquee':
        case 'calibrate': {
          if (!gesture.moved && distance(point, gesture.startScreen) < DRAG_THRESHOLD) return
          gesture.moved = true
          const rect = rectFromPoints(gesture.startWorld, world)
          if (gesture.kind === 'marquee') setMarquee(rect)
          else setCalibration(rect)
          break
        }
      }
    }

    const onUp = (event: PointerEvent) => {
      const gesture = gestureRef.current
      if (!gesture || event.pointerId !== gesture.pointerId) return
      gestureRef.current = null
      const { dmCamera, dmViewport, selection, liveDrag } = useUiStore.getState()
      const world = screenToWorld(screenPoint(event), dmCamera, dmViewport)
      switch (gesture.kind) {
        case 'pan':
          setPanning(false)
          if (
            gesture.button === 2 &&
            distance(gesture.start, screenPoint(event)) >= DRAG_THRESHOLD
          ) {
            rightPanEndedAt = performance.now()
          }
          break
        case 'drag':
          if (gesture.moved && liveDrag) {
            moveItems(liveDrag)
          } else if (event.altKey) {
            ping(world) // Alt+click pings, even on an item (Alt+drag still moves it freely)
          } else if (gesture.selectOnlyOnClick) {
            setSelection([gesture.primaryId])
          }
          useUiStore.setState({ liveDrag: null, dragPrimaryId: null })
          break
        case 'measure': {
          const { measurement } = useUiStore.getState()
          const drawing = gesture.moved || gesture.continued
          if (!drawing && gesture.alt) {
            // Alt+click pings, like with the other tools (a finished ruler stays).
            ping(world)
          } else if (event.shiftKey && measurement && drawing) {
            // Shift on release keeps this point as a waypoint; the end follows the pointer.
            const end = measurement.points.at(-1)
            if (end)
              useUiStore.setState({
                measurement: { points: [...measurement.points, end] },
                measuring: 'waypoint',
              })
          } else if (!drawing) {
            // A plain click clears the ruler.
            useUiStore.setState({ measurement: null, measuring: null })
          } else {
            useUiStore.setState({ measuring: null })
          }
          break
        }
        case 'aoePlace': {
          const ui = useUiStore.getState()
          if (!gesture.moved && gesture.alt) {
            // Alt+click pings, and leaves the template being placed alone.
            ping(world)
          } else if (!gesture.moved) {
            // A click places one the size of the last one.
            useUiStore.setState({
              tempTemplate: newTempTemplate(gesture.origin, ui.tempTemplate?.directionDeg),
            })
          } else if (ui.tempTemplate) {
            useUiStore.setState({ aoeLastSizeFt: ui.tempTemplate.sizeFt })
          }
          break
        }
        case 'templateDrag': {
          if (gesture.moved && liveDrag) {
            moveTemplates(liveDrag)
          } else if (event.altKey) {
            ping(world)
          }
          useUiStore.setState({ liveDrag: null })
          break
        }
        case 'marquee': {
          setMarquee(null)
          if (!gesture.moved) {
            if (event.altKey) ping(world)
            else if (!gesture.additive) setSelection([])
            break
          }
          const rect = rectFromPoints(gesture.startWorld, world)
          const current = currentScene()
          const hits = allItems(current)
            .filter(
              (ref) => isItemMovable(current, ref) && rectsIntersect(rect, itemBounds(ref.item)),
            )
            .map(({ item }) => item.id)
          setSelection(gesture.additive ? [...new Set([...selection, ...hits])] : hits)
          break
        }
        case 'fogRect': {
          const draft = useUiStore.getState().fogDraft
          useUiStore.setState({ fogDraft: null })
          if (!gesture.moved && gesture.alt) ping(gesture.startWorld)
          if (!gesture.moved || draft?.type !== 'rect' || currentScene().id !== gesture.sceneId) {
            break
          }
          const rect = rectFromPoints(draft.from, draft.to)
          addFogEdit(useUiStore.getState().fogMode, { type: 'rect', ...rect })
          break
        }
        case 'fogBrush': {
          useUiStore.setState({ fogDraft: null })
          if (currentScene().id !== gesture.sceneId) break
          addFogEdit(useUiStore.getState().fogMode, {
            type: 'brush',
            points: flatPoints(gesture.points),
            radius: gesture.radius,
          })
          break
        }
        case 'calibrate': {
          setCalibration(null)
          if (!gesture.moved) break
          const rect = rectFromPoints(gesture.startWorld, world)
          if (calibrateGrid(rect, useUiStore.getState().calibrationCells)) setTool('select')
          else notify('That box is too small: drag it over whole cells of the map grid.')
          break
        }
      }
    }

    const cancel = () => {
      const gesture = gestureRef.current
      if (!gesture) return false
      gestureRef.current = null
      setMarquee(null)
      setCalibration(null)
      setPanning(false)
      useUiStore.setState({ liveDrag: null, dragPrimaryId: null })
      if (gesture.kind === 'fogRect' || gesture.kind === 'fogBrush') {
        useUiStore.setState({ fogDraft: null })
      }
      if (gesture.kind === 'measure') useUiStore.setState({ measurement: null, measuring: null })
      if (gesture.kind === 'aoePlace' && gesture.moved) useUiStore.setState({ tempTemplate: null })
      return true
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && cancel()) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      if (event.code === 'Space' && !event.repeat && isCanvasKeyTarget(event.target)) {
        event.preventDefault()
        spaceRef.current = true
        setSpaceHeld(true)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceRef.current = false
        setSpaceHeld(false)
      }
    }
    const onBlur = () => {
      cancel()
      spaceRef.current = false
      setSpaceHeld(false)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    const onPointerCancel = (event: PointerEvent) => {
      if (gestureRef.current?.pointerId === event.pointerId) cancel()
    }
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  /** Fog tool: a rectangle or brush stroke starts a gesture; a polygon collects clicked corners. */
  const startFogShape = (event: PointerEvent, point: Point, world: Point) => {
    const { fogShape, fogBrushCells, fogDraft, dmCamera } = useUiStore.getState()
    const { grid } = currentScene()
    if (fogShape === 'polygon') {
      const points = fogDraft?.type === 'polygon' ? fogDraft.points : []
      const first = points[0]
      const last = points.at(-1)
      // A click on the first corner closes the polygon.
      if (first && points.length >= 3 && distance(first, world) * dmCamera.zoom <= 10) {
        closeFogPolygon()
        return
      }
      // A second click on the last corner (a double-click) closes it too, and
      // never adds a duplicate corner. Konva's dblclick is not used: it fires
      // for any two clicks within 400 ms, so quick corners would close it.
      if (last && distance(last, world) * dmCamera.zoom <= 6) {
        if (points.length >= 3) closeFogPolygon()
        return
      }
      useUiStore.setState({
        fogDraft: { type: 'polygon', points: [...points, world], cursor: world },
      })
      return
    }
    if (fogShape === 'brush') {
      const radius = (fogBrushCells * grid.size) / 2
      gestureRef.current = {
        kind: 'fogBrush',
        pointerId: event.pointerId,
        radius,
        points: [world],
        sceneId: currentScene().id,
      }
      useUiStore.setState({ fogDraft: { type: 'brush', points: [world], radius } })
      return
    }
    const snap = getCampaign().settings.snapEnabled && !event.altKey
    const start = snap
      ? {
          x: nearestLine(world.x, grid.offsetX, grid.size),
          y: nearestLine(world.y, grid.offsetY, grid.size),
        }
      : world
    gestureRef.current = {
      kind: 'fogRect',
      pointerId: event.pointerId,
      startScreen: point,
      startWorld: start,
      moved: false,
      snap,
      alt: event.altKey,
      sceneId: currentScene().id,
    }
  }

  const onPointerDown = (e: KonvaEventObject<PointerEvent>) => {
    const event = e.evt
    if (gestureRef.current) return
    containerRef.current?.focus({ preventScroll: true })
    useUiStore.setState({ contextMenu: null })
    const stage = stageRef.current
    const point = stage?.getPointerPosition()
    if (!stage || !point) return
    const { dmCamera, dmViewport, tool: currentTool, selection } = useUiStore.getState()
    const world = screenToWorld(point, dmCamera, dmViewport)
    const onEmpty = e.target === stage

    // Middle button, Space + left button, or right button on empty space: pan.
    if (
      event.button === 1 ||
      (event.button === 0 && spaceRef.current) ||
      (event.button === 2 && onEmpty)
    ) {
      event.preventDefault()
      gestureRef.current = {
        kind: 'pan',
        pointerId: event.pointerId,
        button: event.button,
        start: point,
        last: point,
      }
      setPanning(true)
      return
    }
    if (event.button !== 0 || isTransformerPart(e.target)) return
    // "Preview as players" only looks: panning and zooming still work, editing does not.
    if (useUiStore.getState().previewAsPlayers) return

    // The Ping tool, and Alt+click with any other tool than Select (whose Alt+drag
    // moves freely) and the fog rectangle (whose Alt+drag draws free corners; both
    // decide on release: a click without a drag still pings).
    const altDrags =
      currentTool === 'select' ||
      currentTool === 'measure' ||
      currentTool === 'aoe' ||
      (currentTool === 'fog' && useUiStore.getState().fogShape === 'rect')
    if (currentTool === 'ping' || (event.altKey && !altDrags)) {
      ping(world)
      return
    }
    if (currentTool === 'fog') {
      startFogShape(event, point, world)
      return
    }
    if (currentTool === 'measure') {
      const { measuring, measurement } = useUiStore.getState()
      const continued = measuring === 'waypoint' && measurement !== null
      if (continued) {
        setRulerEnd(rulerPoint(world, event.altKey))
        useUiStore.setState({ measuring: 'drag' })
      }
      gestureRef.current = {
        kind: 'measure',
        pointerId: event.pointerId,
        startScreen: point,
        start: rulerPoint(world, event.altKey),
        moved: false,
        continued,
        alt: event.altKey,
      }
      return
    }
    if (currentTool === 'aoe') {
      const ui = useUiStore.getState()
      const free = event.altKey || !getCampaign().settings.snapEnabled
      const origin = free ? world : snapTemplateOrigin(ui.aoeShape, world, aoeGrid())
      gestureRef.current = {
        kind: 'aoePlace',
        pointerId: event.pointerId,
        startScreen: point,
        origin,
        moved: false,
        alt: event.altKey,
      }
      return
    }
    if (currentTool === 'calibrate') {
      gestureRef.current = {
        kind: 'calibrate',
        pointerId: event.pointerId,
        startScreen: point,
        startWorld: world,
        moved: false,
      }
      return
    }
    if (currentTool !== 'select') return

    // A pinned template (its outline or origin handle): select it and drag it.
    const templateId = templateIdOf(e.target)
    if (templateId !== null) {
      const next = event.shiftKey
        ? selection.includes(templateId)
          ? selection.filter((s) => s !== templateId)
          : [...selection, templateId]
        : selection.includes(templateId)
          ? selection
          : [templateId]
      setSelection(next)
      if (!next.includes(templateId)) return
      const current = currentScene()
      const origins: Record<Id, Point> = {}
      for (const selectedId of selectedTemplateIds(current, next)) {
        const template = findTemplate(current, selectedId)
        if (template) origins[selectedId] = { x: template.originX, y: template.originY }
      }
      gestureRef.current = {
        kind: 'templateDrag',
        pointerId: event.pointerId,
        startScreen: point,
        startWorld: world,
        primaryId: templateId,
        origins,
        moved: false,
      }
      return
    }

    const id = itemIdOf(e.target)
    // Alt+click on something that cannot move (locked item or layer) pings without selecting it.
    if (event.altKey && id !== null) {
      const target = findItem(currentScene(), id)
      if (!target || !isItemMovable(currentScene(), target)) {
        ping(world)
        return
      }
    }
    if (id === null) {
      gestureRef.current = {
        kind: 'marquee',
        pointerId: event.pointerId,
        startScreen: point,
        startWorld: world,
        additive: event.shiftKey,
        moved: false,
      }
      return
    }

    let next = selection
    if (event.shiftKey) {
      next = selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]
    } else if (!selection.includes(id)) {
      next = [id]
    }
    setSelection(next)
    if (!next.includes(id)) return

    const current = currentScene()
    const ref = findItem(current, id)
    const movable = movableIds(next)
    if (!ref || !movable.includes(id)) return
    const origins: Record<Id, Point> = {}
    for (const movableId of movable) {
      const item = findItem(current, movableId)?.item
      if (item) origins[movableId] = { x: item.x, y: item.y }
    }
    // Snap against the grabbed item, or against a token when the selection has one,
    // so every token lands on its cells even when the drag started on a prop.
    const snapRef =
      ref.layer === 'tokens'
        ? ref
        : (movable.map((m) => findItem(current, m)).find((r) => r?.layer === 'tokens') ?? ref)
    const span =
      snapRef.layer === 'tokens'
        ? tokenSpan((snapRef.item as Token).sizeCategory, current.grid.size)
        : 0
    gestureRef.current = {
      kind: 'drag',
      pointerId: event.pointerId,
      startScreen: point,
      startWorld: world,
      primaryId: id,
      snapId: snapRef.item.id,
      origins,
      footprint:
        snapRef.layer === 'tokens'
          ? { width: span, height: span }
          : rotatedExtent(snapRef.item.width, snapRef.item.height, snapRef.item.rotation),
      snapThreshold: snapRef.layer === 'tokens' ? Infinity : SNAP_THRESHOLD,
      moved: false,
      selectOnlyOnClick: !event.shiftKey && selection.includes(id) && selection.length > 1,
    }
  }

  const onPointerMove = (e: KonvaEventObject<PointerEvent>) => {
    const stage = stageRef.current
    const point = stage?.getPointerPosition()
    if (!stage || !point) return
    const { dmCamera, dmViewport, tool: currentTool, hoveredId: hovered } = useUiStore.getState()
    setPointerWorld(screenToWorld(point, dmCamera, dmViewport))
    if (gestureRef.current) return
    const { fogDraft, measuring } = useUiStore.getState()
    if (currentTool === 'measure' && measuring === 'waypoint') {
      setRulerEnd(rulerPoint(screenToWorld(point, dmCamera, dmViewport), e.evt.altKey))
    }
    if (currentTool === 'fog' && fogDraft?.type === 'polygon') {
      useUiStore.setState({
        fogDraft: { ...fogDraft, cursor: screenToWorld(point, dmCamera, dmViewport) },
      })
    }
    const id = currentTool === 'select' ? itemIdOf(e.target) : null
    if (id !== hovered) useUiStore.setState({ hoveredId: id })
  }

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const point = stageRef.current?.getPointerPosition()
    if (!point) return
    const { dmCamera, dmViewport } = useUiStore.getState()
    const factor = wheelZoomFactor(e.evt.deltaY, e.evt.deltaMode)
    useUiStore.setState({ dmCamera: zoomAt(dmCamera, dmViewport, point, dmCamera.zoom * factor) })
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const { dmCamera, dmViewport } = useUiStore.getState()
    const world = screenToWorld(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      dmCamera,
      dmViewport,
    )
    // Image files dropped on the canvas are maps (Decision 54).
    if (event.dataTransfer.types.includes('Files')) {
      void importAndPlace([...event.dataTransfer.files], 'map', world, event.altKey)
      return
    }
    const entry = parseLibraryEntry(event.dataTransfer.getData(LIBRARY_MIME))
    if (entry) placeLibraryEntry(entry, world, event.altKey)
  }

  const transform = stageTransform(camera, viewport)
  const hoveredMovable = (() => {
    if (hoveredId === null) return false
    const ref = findItem(scene, hoveredId)
    return ref !== null && isItemMovable(scene, ref)
  })()
  const cursor =
    panning || dragging
      ? 'grabbing'
      : spaceHeld
        ? 'grab'
        : tool === 'calibrate' ||
            tool === 'ping' ||
            tool === 'fog' ||
            tool === 'measure' ||
            tool === 'aoe'
          ? 'crosshair'
          : hoveredMovable
            ? 'move'
            : 'default'
  const { layers, layerState, grid } = scene

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="relative h-full w-full touch-none overflow-hidden bg-bg outline-none select-none"
      style={{ cursor }}
      id="dm-canvas"
      data-testid="dm-canvas"
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={(event) => event.preventDefault()}
      onPointerLeave={() => {
        setPointerWorld(null)
        if (!gestureRef.current) useUiStore.setState({ hoveredId: null })
      }}
    >
      {viewport.width > 0 && viewport.height > 0 && (
        <Stage
          key={dpr}
          ref={stageRef}
          width={viewport.width}
          height={viewport.height}
          x={transform.x}
          y={transform.y}
          scaleX={transform.scale}
          scaleY={transform.scale}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onWheel={onWheel}
          onContextMenu={onContextMenu}
        >
          {preview && (
            <PlayersPreview cover={visibleRect(camera, viewport)} scale={transform.scale} />
          )}
          <Layer
            visible={!preview && layerState.map.visible}
            listening={!preview && isLayerInteractive(scene, 'map')}
          >
            <DmItems items={layers.map} />
          </Layer>
          <Layer visible={!preview} listening={!preview}>
            {grid.visible && (
              <GridShape
                size={grid.size}
                offsetX={grid.offsetX}
                offsetY={grid.offsetY}
                color={grid.color}
                opacity={grid.opacity}
              />
            )}
            <Group
              visible={layerState.props.visible}
              listening={isLayerInteractive(scene, 'props')}
            >
              <DmItems items={layers.props} />
            </Group>
            <Group
              visible={layerState.tokens.visible}
              listening={isLayerInteractive(scene, 'tokens')}
            >
              <DmTokens tokens={layers.tokens} />
            </Group>
          </Layer>
          {!preview && <DmFogTint cover={visibleRect(camera, viewport)} />}
          {/* Templates and the ruler; pinned templates are picked with the Select tool. */}
          <Layer visible={!preview} listening={!preview && tool === 'select'}>
            <Annotations scale={transform.scale} cover={visibleRect(camera, viewport)} />
          </Layer>
          <Layer visible={!preview} listening={!preview}>
            <Overlay marquee={marquee} calibration={calibration} />
          </Layer>
        </Stage>
      )}
      <CanvasHud />
    </div>
  )
}

/** Keys typed into form fields or buttons must not pan the canvas. */
function isCanvasKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true
  return !target.closest(
    'input, textarea, select, button, [contenteditable="true"], [role="menu"], dialog',
  )
}
