// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderHook } from '@testing-library/react'
import { useResizable } from './useResizable'
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function setup(options: Parameters<typeof useResizable>[0]) {
  const utils = renderHook(() => useResizable(options))
  const { result } = utils
  return { result, utils }
}

describe('useResizable', () => {
  beforeEach(() => {
    vi.spyOn(document, 'addEventListener')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  })

  it('returns the initial width', () => {
    const { result } = setup({ initialWidth: 300, minWidth: 200, maxWidth: 600, direction: 'left' })
    expect(result.current.width).toBe(300)
    expect(result.current.isResizing).toBe(false)
  })

  it('activates resizing on mousedown', () => {
    const { result } = setup({ initialWidth: 300, minWidth: 200, maxWidth: 600, direction: 'left' })
    const fakeEvent = {
      clientX: 100,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.MouseEvent
    act(() => {
      result.current.handleMouseDown(fakeEvent)
    })
    expect(result.current.isResizing).toBe(true)
    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')
  })

  it('increases width when dragging right on a left-anchored sidebar', () => {
    const { result } = setup({ initialWidth: 300, minWidth: 200, maxWidth: 600, direction: 'left' })
    const downEvent = {
      clientX: 100,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.MouseEvent
    act(() => result.current.handleMouseDown(downEvent))

    // simulate mousemove: +50px to the right
    const moveEvent = new MouseEvent('mousemove', { clientX: 150 })
    act(() => {
      document.dispatchEvent(moveEvent)
    })
    expect(result.current.width).toBe(350)
  })

  it('decreases width when dragging left on a right-anchored sidebar', () => {
    const { result } = setup({ initialWidth: 320, minWidth: 240, maxWidth: 600, direction: 'right' })
    const downEvent = {
      clientX: 500,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.MouseEvent
    act(() => result.current.handleMouseDown(downEvent))

    // simulate mousemove: -80px (drag left) → width increases for right sidebar
    const moveEvent = new MouseEvent('mousemove', { clientX: 420 })
    act(() => {
      document.dispatchEvent(moveEvent)
    })
    expect(result.current.width).toBe(400)
  })

  it('clamps to maxWidth', () => {
    const { result } = setup({ initialWidth: 300, minWidth: 200, maxWidth: 600, direction: 'left' })
    act(() =>
      result.current.handleMouseDown({
        clientX: 0,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent),
    )
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }))
    })
    expect(result.current.width).toBe(600)
  })

  it('clamps to minWidth', () => {
    const { result } = setup({ initialWidth: 300, minWidth: 200, maxWidth: 600, direction: 'left' })
    act(() =>
      result.current.handleMouseDown({
        clientX: 200,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent),
    )
    // drag far left
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: -500 }))
    })
    expect(result.current.width).toBe(200)
  })

  it('stops resizing on mouseup and restores body styles', () => {
    const { result } = setup({ initialWidth: 300, minWidth: 200, maxWidth: 600, direction: 'left' })
    act(() =>
      result.current.handleMouseDown({
        clientX: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent),
    )
    expect(result.current.isResizing).toBe(true)

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })
    expect(result.current.isResizing).toBe(false)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })
})
