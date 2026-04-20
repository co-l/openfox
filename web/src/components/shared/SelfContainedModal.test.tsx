import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Modal } from './SelfContainedModal'

describe('Modal', () => {
  it('renders label as button', () => {
    const html = renderToStaticMarkup(<Modal label="Open">Content</Modal>)
    expect(html).toContain('>Open<')
  })

  it('renders label with className', () => {
    const html = renderToStaticMarkup(<Modal label="Open" className="my-class">Content</Modal>)
    expect(html).toContain('class="my-class"')
  })

  it('renders label as span when not string', () => {
    const html = renderToStaticMarkup(
      <Modal label={<span>Click here</span>}>Content</Modal>
    )
    expect(html).toContain('Click here')
  })
})