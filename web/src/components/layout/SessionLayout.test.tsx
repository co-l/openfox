// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SessionLayout } from './SessionLayout'

vi.mock('../../stores/session/session-scope', () => ({
  useScopedPaneState: () => null,
}))

vi.mock('../plan/SessionSidebar', () => ({
  SessionSidebar: () => <div data-testid="session-sidebar" />,
}))

function render(props: {
  criteriaSidebarOpen?: boolean
  criteriaSidebarOverlay?: boolean
  onCriteriaSidebarToggle?: () => void
}) {
  return renderToStaticMarkup(
    <SessionLayout {...props}>
      <div data-testid="feed">feed</div>
    </SessionLayout>,
  )
}

describe('SessionLayout', () => {
  it('renders the criteria sidebar inline (no backdrop) when not in overlay mode', () => {
    const html = render({ criteriaSidebarOpen: true, criteriaSidebarOverlay: false })

    expect(html).toContain('shrink-0 border-l border-border')
    expect(html).not.toContain('bg-secondary/50')
    expect(html).not.toContain('translate-x-full')
  })

  it('renders a zero-width aside when the inline sidebar is closed', () => {
    const html = render({ criteriaSidebarOpen: false, criteriaSidebarOverlay: false })
    expect(html).toContain('w-0 shrink-0')
  })

  it('renders the criteria sidebar as an overlay with a backdrop in overlay mode', () => {
    const html = render({ criteriaSidebarOpen: true, criteriaSidebarOverlay: true, onCriteriaSidebarToggle: () => {} })

    expect(html).toContain('absolute right-0 top-0')
    expect(html).toContain('translate-x-0')
    expect(html).toContain('bg-secondary/50')
  })

  it('slides the overlay off-screen when closed in overlay mode', () => {
    const html = render({ criteriaSidebarOpen: false, criteriaSidebarOverlay: true })
    expect(html).toContain('translate-x-full')
  })
})
