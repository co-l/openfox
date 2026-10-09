import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'
import type { OverlayScrollbarsComponentRef, OverlayScrollbarsComponentProps } from 'overlayscrollbars-react'
import type { OverlayScrollbars } from 'overlayscrollbars'
import { SETTINGS_KEYS } from '../../lib/resources'
import { useSetting } from '../../hooks/useSetting'
import type { ScrollbarGestureKind } from '@/hooks/useAutoScroll.ts'

export type { ScrollbarGestureKind }

export type ScrollAreaProps = OverlayScrollbarsComponentProps<'div'> & {
  horizontal?: boolean
  both?: boolean
  onScrollbarGesture?: (kind: ScrollbarGestureKind, gapToEndPx: number | null) => void
}

export const ScrollArea = forwardRef<OverlayScrollbarsComponentRef<'div'>, ScrollAreaProps>((props, ref) => {
  // Only this component's own setting key — ScrollArea mounts inside every
  // modal, so the wider useDisplaySettings() bundle would fire settings
  // fetches from subtrees that never read display settings.
  const useNativeScrollbars = useSetting(SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS, 'false').value === 'true'
  // The setting is read at render time (like OptionalScrollArea): switching
  // it swaps the element type, which remounts the subtree — the decision
  // applies immediately to mounted content.
  if (useNativeScrollbars) {
    return <NativeScrollArea ref={ref} {...props} />
  }
  return <OverlayScrollbarsArea ref={ref} {...props} />
})
ScrollArea.displayName = 'ScrollArea'

/**
 * Plain native-scrolling container. Exposes the same ref contract as the
 * OverlayScrollbars wrapper (osInstance().elements().viewport) so consumers
 * like useViewport, useAutoScroll and the feed reveal logic work unchanged.
 * No MutationObserver/ResizeObserver machinery — that is the point of the
 * setting on a big feed.
 */
const NativeScrollArea = forwardRef<OverlayScrollbarsComponentRef<'div'>, ScrollAreaProps>(
  // `options`, `events`, `defer`, `onScrollbarGesture` and `element` are
  // OverlayScrollbars-only props pulled out of the spread so they never
  // reach the plain div (this component only ever renders a div).
  (
    {
      element: _element,
      options: _options,
      events: _events,
      defer: _defer,
      horizontal,
      both,
      onScrollbarGesture: _onScrollbarGesture,
      className = '',
      style,
      children,
      ...props
    },
    ref,
  ) => {
    const hostRef = useRef<HTMLDivElement | null>(null)

    useImperativeHandle(
      ref,
      () =>
        ({
          osInstance: () =>
            ({
              elements: () => ({ viewport: hostRef.current }),
            }) as unknown as OverlayScrollbars,
          getElement: () => hostRef.current,
        }) as OverlayScrollbarsComponentRef<'div'>,
      [],
    )

    const overflowClass =
      horizontal && both
        ? 'overflow-auto'
        : horizontal
          ? 'overflow-x-auto overflow-y-hidden'
          : 'overflow-y-auto overflow-x-hidden'

    return (
      <div {...props} ref={hostRef} className={`${overflowClass} ${className}`.trim()} style={style}>
        {children}
      </div>
    )
  },
)
NativeScrollArea.displayName = 'NativeScrollArea'

const OverlayScrollbarsArea = forwardRef<OverlayScrollbarsComponentRef<'div'>, ScrollAreaProps>(
  ({ options, horizontal, both, onScrollbarGesture, ...props }, ref) => {
    const isHorizontal = horizontal || both
    const onGestureRef = useRef(onScrollbarGesture)
    onGestureRef.current = onScrollbarGesture
    const cleanupRef = useRef<(() => void) | null>(null)

    const events = useMemo(() => {
      const attach = (instance: OverlayScrollbars) => {
        cleanupRef.current?.()
        const scrollbar = instance.elements().scrollbarVertical
        const getGap = (): number | null => {
          const handleRect = scrollbar.handle.getBoundingClientRect()
          const trackRect = scrollbar.track.getBoundingClientRect()
          if (handleRect.height === 0 || trackRect.height === 0) return null
          return Math.max(0, trackRect.bottom - handleRect.bottom)
        }
        let dragCleanup: (() => void) | null = null
        const endDrag = () => {
          onGestureRef.current?.('up', getGap())
          dragCleanup?.()
        }
        const onMove = (e: PointerEvent) => {
          if (e.buttons === 0) {
            endDrag()
            return
          }
          onGestureRef.current?.('move', getGap())
        }
        const beginDrag = () => {
          onGestureRef.current?.('down', getGap())
          dragCleanup?.()
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', endDrag)
          window.addEventListener('pointercancel', endDrag)
          dragCleanup = () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', endDrag)
            window.removeEventListener('pointercancel', endDrag)
            dragCleanup = null
          }
        }
        scrollbar.track.addEventListener('pointerdown', beginDrag)
        cleanupRef.current = () => {
          scrollbar.track.removeEventListener('pointerdown', beginDrag)
          dragCleanup?.()
        }
      }
      return { initialized: attach }
    }, [])

    useEffect(() => () => cleanupRef.current?.(), [])

    return (
      <OverlayScrollbarsComponent
        ref={ref}
        events={events}
        options={{
          overflow: {
            x: isHorizontal ? 'scroll' : 'hidden',
            y: both ? 'scroll' : horizontal ? 'hidden' : 'scroll',
          },
          scrollbars: {
            autoHide: isHorizontal ? 'leave' : 'move',
            autoHideDelay: isHorizontal ? 1500 : 600,
            clickScroll: 'instant',
          },
          update: {
            elementEvents: [[':scope', 'mouseenter']],
          },
          ...options,
        }}
        {...props}
      />
    )
  },
)
OverlayScrollbarsArea.displayName = 'OverlayScrollbarsArea'
