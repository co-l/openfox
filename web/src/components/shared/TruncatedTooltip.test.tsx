// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TruncatedTooltip } from './TruncatedTooltip'

const LONG_PATH = '/home/user/very/long/project/path/to/a/source/file.ts'

function mockOverflow(overflows: boolean) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: overflows ? 100 : 300 })
  Object.defineProperty(Element.prototype, 'scrollWidth', { configurable: true, value: 300 })
}

afterEach(() => {
  delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth
  delete (Element.prototype as { scrollWidth?: unknown }).scrollWidth
  cleanup()
})

describe('TruncatedTooltip', () => {
  it('renders the text without a tooltip when it fits', () => {
    const { container } = render(<TruncatedTooltip text={LONG_PATH} className="flex-1" />)

    expect(container.textContent).toContain(LONG_PATH)
    expect(container.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('keeps the passed className on the layout wrapper and allows it to shrink', () => {
    const { container } = render(<TruncatedTooltip text="abc" className="flex-1 text-text-muted text-xs" />)

    expect(container.firstElementChild?.className).toContain('flex-1')
    expect(container.firstElementChild?.className).toContain('text-text-muted')
    expect(container.firstElementChild?.className).toContain('text-xs')
    expect(container.firstElementChild?.className).toContain('min-w-0')
  })

  it('shows the full text in a tooltip on hover only when the label overflows', async () => {
    mockOverflow(true)
    const { container } = render(<TruncatedTooltip text={LONG_PATH} className="flex-1" />)

    const trigger = container.firstElementChild as HTMLElement
    fireEvent.mouseEnter(trigger)
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe(LONG_PATH))

    fireEvent.mouseLeave(trigger)
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })

  it('shows the tooltip when hovering the truncated text itself', async () => {
    mockOverflow(true)
    const { container } = render(<TruncatedTooltip text={LONG_PATH} className="flex-1" />)

    const label = container.querySelector('.truncate') as HTMLElement
    fireEvent.mouseEnter(label)
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe(LONG_PATH))
  })

  it('does not show a tooltip on hover when the text fits', async () => {
    mockOverflow(false)
    const { container } = render(<TruncatedTooltip text={LONG_PATH} className="flex-1" />)

    fireEvent.mouseEnter(container.firstElementChild as HTMLElement)
    await new Promise((resolve) => setTimeout(resolve, 250))

    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
