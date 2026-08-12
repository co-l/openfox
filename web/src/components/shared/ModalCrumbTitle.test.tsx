// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ModalCrumbTitle } from './ModalCrumbTitle'

vi.mock('./icons', () => ({
  ChevronRightIcon: () => '[chevron]',
}))

describe('ModalCrumbTitle', () => {
  it('renders the project name, a chevron, and the action label', () => {
    const html = renderToStaticMarkup(<ModalCrumbTitle projectName="openfox">Tasks</ModalCrumbTitle>)

    expect(html).toContain('openfox')
    expect(html).toContain('[chevron]')
    expect(html).toContain('Tasks')
  })
})
