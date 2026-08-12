// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { DropdownMenu, type DropdownMenuItem } from './DropdownMenu'

vi.mock('wouter', () => ({
  Link: ({ children, href, onClick, className }: any) => (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  ),
}))

const ITEMS: DropdownMenuItem[] = [
  { label: 'Item 1', onClick: vi.fn() },
  { label: 'Item 2', onClick: vi.fn() },
  { label: 'Item 3', onClick: vi.fn() },
]

function render(ui: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(ui)
  })
  return container
}

function getMenu(): HTMLElement | null {
  return document.querySelector('[data-testid="session-dropdown-menu"]')
}

function clickTrigger(container: HTMLElement) {
  const trigger = container.querySelector('button')
  if (!trigger) throw new Error('Trigger button not found')
  act(() => {
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

describe('DropdownMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  describe('open/close', () => {
    it('renders the trigger', () => {
      const container = render(<DropdownMenu items={ITEMS} trigger={<button>Open</button>} />)
      expect(container.textContent).toBe('Open')
      expect(getMenu()).toBeNull()
    })

    it('opens the menu when trigger is clicked', () => {
      const container = render(<DropdownMenu items={ITEMS} trigger={<button>Open</button>} />)
      clickTrigger(container)
      expect(getMenu()).toBeTruthy()
    })

    it('calls onOpenChange when controlled', () => {
      const onOpenChange = vi.fn()
      const container = render(
        <DropdownMenu items={ITEMS} trigger={<button>Open</button>} isOpen={false} onOpenChange={onOpenChange} />,
      )
      clickTrigger(container)
      expect(onOpenChange).toHaveBeenCalledWith(true)
    })
  })

  describe('item rendering', () => {
    it('renders all items', () => {
      const items: DropdownMenuItem[] = [
        { label: 'Alpha', onClick: vi.fn() },
        { label: 'Beta', onClick: vi.fn() },
      ]
      const container = render(<DropdownMenu items={items} trigger={<button>Open</button>} />)
      clickTrigger(container)
      const menu = getMenu()
      expect(menu?.textContent).toContain('Alpha')
      expect(menu?.textContent).toContain('Beta')
    })

    it('renders footer items', () => {
      const items: DropdownMenuItem[] = [{ label: 'Main', onClick: vi.fn() }]
      const footerItems: DropdownMenuItem[] = [{ label: 'Footer', onClick: vi.fn() }]
      const container = render(<DropdownMenu items={items} footerItems={footerItems} trigger={<button>Open</button>} />)
      clickTrigger(container)
      const menu = getMenu()
      expect(menu?.textContent).toContain('Main')
      expect(menu?.textContent).toContain('Footer')
    })

    it('renders href items as links', () => {
      const items: DropdownMenuItem[] = [{ label: 'Link Item', href: '/some/page', onClick: vi.fn() }]
      const container = render(<DropdownMenu items={items} trigger={<button>Open</button>} />)
      clickTrigger(container)
      const menu = getMenu()
      const link = menu?.querySelector('a')
      expect(link).toBeTruthy()
      expect(link?.getAttribute('href')).toBe('/some/page')
    })
  })

  describe('positioning', () => {
    it('right-aligns the menu with the trigger right edge when align="right"', () => {
      const container = render(
        <DropdownMenu items={ITEMS} trigger={<button>Open</button>} minWidth="176px" align="right" />,
      )
      clickTrigger(container)
      // jsdom reports a zero-size trigger rect, so right alignment lands the
      // menu's left edge at -(minWidth) — anchored to the trigger's right.
      expect(getMenu()?.style.left).toBe('-176px')
    })
  })

  // Keyboard navigation tests require useEffect to fire (keyboard listener + initial
  // selection are set up in effects). React.act doesn't flush effects in React 19,
  // so these can't be tested with unit tests. Covered by e2e tests instead.
})
