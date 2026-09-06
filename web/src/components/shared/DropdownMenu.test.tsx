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
    const originalRect = HTMLElement.prototype.getBoundingClientRect

    function stubRects(
      triggerRect: Partial<DOMRect>,
      menuRect: Partial<DOMRect>,
      innerWidth: number,
      innerHeight: number,
    ) {
      Object.defineProperty(window, 'innerWidth', { value: innerWidth, configurable: true })
      Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true })
      HTMLElement.prototype.getBoundingClientRect = function (): DOMRect {
        const r = this.getAttribute?.('data-testid') === 'session-dropdown-menu' ? menuRect : triggerRect
        return {
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}) as object,
          ...r,
        } as DOMRect
      }
    }

    it('clamps a right-aligned menu so it never overflows the viewport', () => {
      const container = render(
        <DropdownMenu items={ITEMS} trigger={<button>Open</button>} minWidth="176px" align="right" />,
      )
      clickTrigger(container)
      // The test DOM reports a zero-size trigger rect, so raw right alignment
      // would push the menu off-screen left; the viewport clamp keeps it at
      // the margin instead.
      expect(getMenu()?.style.left).toBe('8px')
    })

    it('keeps the menu inside the viewport when there is no room below', () => {
      stubRects({ top: 900, left: 1500, right: 1680, bottom: 920 }, { width: 176, height: 300 }, 1600, 1000)
      const container = render(
        <DropdownMenu items={ITEMS} trigger={<button>Open</button>} minWidth="176px" align="right" />,
      )
      clickTrigger(container)
      const menu = getMenu()
      expect(menu).toBeTruthy()
      const left = Number.parseFloat(menu!.style.left)
      const top = Number.parseFloat(menu!.style.top)
      // Right edge would overflow (1680 > 1600): clamped to the right margin.
      expect(left).toBe(1600 - 176 - 8)
      // No room below (920+4 vs 1000): flipped above the trigger, inside margins.
      expect(top).toBeLessThan(900)
      expect(top).toBeGreaterThanOrEqual(8)
      HTMLElement.prototype.getBoundingClientRect = originalRect
    })

    it('renders as a centered modal below the mobile breakpoint', () => {
      const original = window.innerWidth
      Object.defineProperty(window, 'innerWidth', { value: 480, configurable: true })
      const container = render(<DropdownMenu items={ITEMS} trigger={<button>Open</button>} />)
      clickTrigger(container)
      expect(document.querySelector('[data-testid="session-dropdown-overlay"]')).toBeTruthy()
      expect(getMenu()).toBeTruthy()
      Object.defineProperty(window, 'innerWidth', { value: original, configurable: true })
    })
  })

  // Keyboard navigation tests require useEffect to fire (keyboard listener + initial
  // selection are set up in effects). React.act doesn't flush effects in React 19,
  // so these can't be tested with unit tests. Covered by e2e tests instead.
})
