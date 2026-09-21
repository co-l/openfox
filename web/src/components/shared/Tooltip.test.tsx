// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Tooltip } from './Tooltip'

afterEach(cleanup)

describe('Tooltip', () => {
  it('renders children in the trigger span with the default inline-flex class', () => {
    const { container } = render(<Tooltip content="tip content">hover me</Tooltip>)

    const trigger = container.firstElementChild as HTMLElement
    expect(trigger?.className).toContain('inline-flex')
    expect(container.textContent).toContain('hover me')
  })

  it('applies triggerClassName to the trigger span', () => {
    const { container } = render(
      <Tooltip content="tip content" triggerClassName="flex-1 min-w-0">
        hover me
      </Tooltip>,
    )

    const trigger = container.firstElementChild as HTMLElement
    expect(trigger?.className).toBe('flex-1 min-w-0')
  })

  it('shows the content on hover and hides it on mouse leave', async () => {
    const { container } = render(<Tooltip content="full tip text">hover me</Tooltip>)

    const trigger = container.firstElementChild as HTMLElement
    fireEvent.mouseEnter(trigger)
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe('full tip text'))

    fireEvent.mouseLeave(trigger)
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })

  it('does not show the content on hover when disabled', async () => {
    const { container } = render(
      <Tooltip content="full tip text" enabled={false}>
        hover me
      </Tooltip>,
    )

    const trigger = container.firstElementChild as HTMLElement
    fireEvent.mouseEnter(trigger)
    await new Promise((resolve) => setTimeout(resolve, 250))

    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
