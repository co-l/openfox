import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { OverlayScrollbarsComponentRef } from 'overlayscrollbars-react'

const MIN_ZOOM = 0.1
const MAX_ZOOM = 4
const ZOOM_STEP = 1.25
const FIT_PADDING = 24
const EPSILON = 1e-6

function readCanvasSize(svgRef: RefObject<SVGSVGElement | null>): { width: number; height: number } {
  const vb = svgRef.current?.viewBox.baseVal
  if (!vb || vb.width <= 0 || vb.height <= 0) return { width: 0, height: 0 }
  return { width: vb.width, height: vb.height }
}

export function useWorkflowZoom(
  scrollRef: RefObject<OverlayScrollbarsComponentRef<'div'> | null>,
  svgRef: RefObject<SVGSVGElement | null>,
  workflowKey: string,
  contentKey: string,
) {
  const [zoom, setZoom] = useState(1)
  const [fitZoom, setFitZoom] = useState(1)
  const [canFit, setCanFit] = useState(true)
  const fitZoomRef = useRef(1)
  const workflowKeyRef = useRef<string | null>(null)
  const didInitialFitRef = useRef(false)

  const getViewport = useCallback(() => scrollRef.current?.osInstance()?.elements().viewport ?? null, [scrollRef])

  const computeFit = useCallback(() => {
    const vp = getViewport()
    if (!vp) return
    const { width: canvasWidth, height: canvasHeight } = readCanvasSize(svgRef)
    if (canvasWidth <= 0 || canvasHeight <= 0) return
    const cw = vp.clientWidth - FIT_PADDING * 2
    const ch = vp.clientHeight - FIT_PADDING * 2
    if (cw <= 0 || ch <= 0) return
    const fit = Math.min(cw / canvasWidth, ch / canvasHeight)
    const bounded = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fit))
    fitZoomRef.current = bounded
    setFitZoom(bounded)
    setCanFit(bounded >= fit - EPSILON)
  }, [getViewport, svgRef])

  const fitToScreen = useCallback(() => {
    const vp = getViewport()
    if (!vp) return
    const { width: canvasWidth, height: canvasHeight } = readCanvasSize(svgRef)
    if (canvasWidth <= 0 || canvasHeight <= 0) return
    const target = fitZoomRef.current
    setZoom(target)
    vp.scrollTo({
      left: Math.max(0, (canvasWidth * target - vp.clientWidth) / 2),
      top: Math.max(0, (canvasHeight * target - vp.clientHeight) / 2),
    })
  }, [getViewport, svgRef])

  useLayoutEffect(() => {
    computeFit()
  }, [computeFit, contentKey])

  useEffect(() => {
    const vp = getViewport()
    if (!vp || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      computeFit()
      if (!didInitialFitRef.current && vp.clientWidth > 0 && vp.clientHeight > 0) {
        didInitialFitRef.current = true
        requestAnimationFrame(() => fitToScreen())
      }
    })
    ro.observe(vp)
    return () => ro.disconnect()
  }, [getViewport, computeFit, fitToScreen])

  const setZoomAroundClient = useCallback(
    (next: number, clientX: number, clientY: number) => {
      const vp = getViewport()
      const svg = svgRef.current
      if (!vp || !svg) return
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next))
      const svgRect = svg.getBoundingClientRect()
      const vpRect = vp.getBoundingClientRect()
      const svgUserX = (clientX - svgRect.left) / zoom
      const svgUserY = (clientY - svgRect.top) / zoom
      const contentOffsetX = svgRect.left - vpRect.left + vp.scrollLeft
      const contentOffsetY = svgRect.top - vpRect.top + vp.scrollTop
      vp.scrollLeft = contentOffsetX + svgUserX * clamped - (clientX - vpRect.left)
      vp.scrollTop = contentOffsetY + svgUserY * clamped - (clientY - vpRect.top)
      setZoom(clamped)
    },
    [getViewport, svgRef, zoom],
  )

  const zoomBy = useCallback(
    (factor: number) => {
      const vp = getViewport()
      if (!vp) return
      const vpRect = vp.getBoundingClientRect()
      setZoomAroundClient(zoom * factor, vpRect.left + vpRect.width / 2, vpRect.top + vpRect.height / 2)
    },
    [getViewport, zoom, setZoomAroundClient],
  )

  const zoomIn = useCallback(() => zoomBy(ZOOM_STEP), [zoomBy])
  const zoomOut = useCallback(() => zoomBy(1 / ZOOM_STEP), [zoomBy])

  const onWheel = useCallback(
    (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
      setZoomAroundClient(zoom * factor, e.clientX, e.clientY)
    },
    [zoom, setZoomAroundClient],
  )

  useEffect(() => {
    const vp = getViewport()
    if (!vp) return
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [getViewport, onWheel])

  useEffect(() => {
    if (workflowKeyRef.current === workflowKey) return
    workflowKeyRef.current = workflowKey
    didInitialFitRef.current = false
    const vp = getViewport()
    if (!vp) return
    computeFit()
    requestAnimationFrame(() => fitToScreen())
  }, [workflowKey, getViewport, computeFit, fitToScreen])

  return {
    zoom,
    zoomIn,
    zoomOut,
    fitToScreen,
    canZoomIn: zoom < MAX_ZOOM - EPSILON,
    canZoomOut: zoom > MIN_ZOOM + EPSILON,
    isFitted: canFit && Math.abs(zoom - fitZoom) < EPSILON,
  }
}
