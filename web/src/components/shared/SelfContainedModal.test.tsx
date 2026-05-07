import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, vi, expect, beforeEach } from 'vitest'
import { Modal } from './SelfContainedModal'

describe('Modal', () => {
  beforeEach(() => {
    if (typeof document !== 'undefined') {
      document.body.innerHTML = ''
    }
  })

  it('renders label as button', () => {
    const html = renderToStaticMarkup(<Modal label="Open">Content</Modal>)
    expect(html).toContain('>Open<')
  })

  it('renders label with className', () => {
    const html = renderToStaticMarkup(
      <Modal label="Open" className="my-class">
        Content
      </Modal>,
    )
    expect(html).toContain('class="my-class"')
  })

  it('renders label as span when not string', () => {
    const html = renderToStaticMarkup(<Modal label={<span>Click here</span>}>Content</Modal>)
    expect(html).toContain('Click here')
  })

  it('should call close when Escape key is pressed', async () => {
    if (typeof document === 'undefined') {
      return
    }

    const onClose = vi.fn()

    const { render, screen, fireEvent } = await import('@testing-library/react')

    render(
      <Modal isOpen onClose={onClose} closeOnEscape>
        Content
      </Modal>,
    )

    const modal = screen.getByText('Content')
    fireEvent.keyDown(modal, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should stop propagation of Escape key event', async () => {
    if (typeof document === 'undefined') {
      return
    }

    const { render, screen, fireEvent } = await import('@testing-library/react')
    const onClose = vi.fn()
    const parentHandler = vi.fn()

    render(
      <div onKeyDown={parentHandler}>
        <Modal isOpen onClose={onClose} closeOnEscape>
          Content
        </Modal>
      </div>,
    )

    const modal = screen.getByText('Content')
    fireEvent.keyDown(modal, { key: 'Escape', bubbles: true })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(parentHandler).not.toHaveBeenCalled()
  })
})
