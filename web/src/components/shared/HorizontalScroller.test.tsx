// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { HorizontalScroller } from './HorizontalScroller'

/** jsdom has no layout: fake a 300px viewport over 1000px of content. */
function renderOverflowing(onClick = vi.fn()) {
  render(
    <HorizontalScroller>
      <button onClick={onClick}>tab</button>
    </HorizontalScroller>,
  )
  const row = screen.getByText('tab').parentElement!
  Object.defineProperty(row, 'clientWidth', { value: 300 })
  Object.defineProperty(row, 'scrollWidth', { value: 1000 })
  fireEvent.scroll(row)
  return { row, onClick }
}

describe('HorizontalScroller', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows only the forward arrow at the start, both once scrolled', () => {
    const { row } = renderOverflowing()
    expect(screen.queryByLabelText('Scroll left')).toBeNull()
    expect(screen.getByLabelText('Scroll right')).toBeDefined()
    row.scrollLeft = 200
    fireEvent.scroll(row)
    expect(screen.getByLabelText('Scroll left')).toBeDefined()
  })

  it('scrolls by most of a page when an arrow is clicked', () => {
    const { row } = renderOverflowing()
    row.scrollBy = vi.fn()
    fireEvent.click(screen.getByLabelText('Scroll right'))
    expect(row.scrollBy).toHaveBeenCalledWith({ left: 240, behavior: 'smooth' })
  })

  it('turns a vertical mouse wheel into horizontal scrolling', () => {
    const { row } = renderOverflowing()
    fireEvent.wheel(row, { deltaY: 120 })
    expect(row.scrollLeft).toBe(120)
  })

  it('drags with the mouse and swallows the click that ends the drag', () => {
    const { row, onClick } = renderOverflowing()
    row.setPointerCapture = vi.fn()
    const tab = screen.getByText('tab')
    fireEvent.pointerDown(tab, { pointerType: 'mouse', button: 0, clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(tab, { pointerType: 'mouse', clientX: 400, pointerId: 1 })
    fireEvent.pointerUp(tab, { pointerType: 'mouse', clientX: 400, pointerId: 1 })
    fireEvent.click(tab)
    expect(row.scrollLeft).toBe(100)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('still clicks a tab when the mouse barely moved', () => {
    const { onClick } = renderOverflowing()
    const tab = screen.getByText('tab')
    fireEvent.pointerDown(tab, { pointerType: 'mouse', button: 0, clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(tab, { pointerType: 'mouse', clientX: 498, pointerId: 1 })
    fireEvent.pointerUp(tab, { pointerType: 'mouse', clientX: 498, pointerId: 1 })
    fireEvent.click(tab)
    expect(onClick).toHaveBeenCalledOnce()
  })
})
