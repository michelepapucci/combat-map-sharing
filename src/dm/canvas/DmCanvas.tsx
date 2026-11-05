import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Group, Layer, Stage } from 'react-konva'
import { GridShape } from '../../canvas/GridShape'
import {
  panBy,
  screenToWorld,
  stageTransform,
  wheelZoomFactor,
  zoomAt,
} from '../../geometry/camera'
import { itemBounds, rectFromPoints, rectsIntersect } from '../../geometry/rect'
import { rotatedExtent, SNAP_THRESHOLD, snapCenter, tokenSpan } from '../../geometry/snap'
import type { Point, Rect, Size } from '../../geometry/types'
import { allItems, findItem, isItemMovable, isLayerInteractive } from '../../state/sceneOps'
import type { Id, Token } from '../../state/types'
import { calibrateGrid, currentScene, moveItems, movableIds } from '../../store/actions'
import { getCampaign, useActiveScene } from '../../store/campaign'
import { notify, setSelection, setTool, useUiStore } from '../../store/ui'
import { LIBRARY_MIME, parseLibraryEntry, placeLibraryEntry } from '../placement'
import { CanvasHud } from './CanvasHud'
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

/** The id of the scene item a Konva event hit, if any. */
function itemIdOf(target: Konva.Node): Id | null {
  const node = target.hasName('item') ? target : target.findAncestor('.item')
  return node ? node.id() : null
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
          } else if (gesture.selectOnlyOnClick) {
            setSelection([gesture.primaryId])
          }
          useUiStore.setState({ liveDrag: null, dragPrimaryId: null })
          break
        case 'marquee': {
          setMarquee(null)
          if (!gesture.moved) {
            if (!gesture.additive) setSelection([])
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

    const id = itemIdOf(e.target)
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
    if (event.dataTransfer.types.includes('Files')) {
      notify('Uploading your own images arrives in milestone 3. For now, use the built-in library.')
      return
    }
    const entry = parseLibraryEntry(event.dataTransfer.getData(LIBRARY_MIME))
    const rect = containerRef.current?.getBoundingClientRect()
    if (!entry || !rect) return
    const { dmCamera, dmViewport } = useUiStore.getState()
    const world = screenToWorld(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      dmCamera,
      dmViewport,
    )
    placeLibraryEntry(entry, world, event.altKey)
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
        : tool === 'calibrate'
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
          <Layer visible={layerState.map.visible} listening={isLayerInteractive(scene, 'map')}>
            <DmItems items={layers.map} />
          </Layer>
          <Layer>
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
          <Layer>
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
