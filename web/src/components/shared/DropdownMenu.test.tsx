// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act, useState } from 'react'
import { render as rtlRender, fireEvent as rtlFireEvent } from '@testing-library/react'
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
    it('renders header when provided', () => {
      const items: DropdownMenuItem[] = [{ label: 'Main', onClick: vi.fn() }]
      const container = render(
        <DropdownMenu items={items} header={<input placeholder="Search items..." />} trigger={<button>Open</button>} />,
      )
      clickTrigger(container)
      const menu = getMenu()
      expect(menu?.querySelector('input[placeholder="Search items..."]')).toBeTruthy()
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

  describe('submenu drill-down', () => {
    const SUBMENU_ITEMS: DropdownMenuItem[] = [
      { label: 'Parent', submenu: { items: [{ label: 'Child 1', onClick: vi.fn() }, { label: 'Child 2' }] } },
    ]

    function clickItem(label: string) {
      const menu = getMenu()
      const button = Array.from(menu?.querySelectorAll('button') ?? []).find((b) => b.textContent?.includes(label))
      if (!button) throw new Error(`Item "${label}" not found`)
      act(() => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })
    }

    it('replaces the menu content with the submenu when clicking a submenu item', () => {
      const container = render(
        <DropdownMenu items={SUBMENU_ITEMS} trigger={<button>Open</button>} submenuBackLabel="Back" />,
      )
      clickTrigger(container)
      clickItem('Parent')
      const menu = getMenu()
      expect(menu?.textContent).toContain('Child 1')
      expect(menu?.textContent).toContain('Child 2')
      expect(menu?.textContent).not.toContain('Parent')
      expect(menu?.textContent).toContain('Back')
    })

    it('keeps the menu open when entering a submenu', () => {
      const container = render(
        <DropdownMenu items={SUBMENU_ITEMS} trigger={<button>Open</button>} submenuBackLabel="Back" />,
      )
      clickTrigger(container)
      clickItem('Parent')
      expect(getMenu()).toBeTruthy()
    })

    it('returns to the parent menu with the back button', () => {
      const container = render(
        <DropdownMenu items={SUBMENU_ITEMS} trigger={<button>Open</button>} submenuBackLabel="Back" />,
      )
      clickTrigger(container)
      clickItem('Parent')
      clickItem('Back')
      const menu = getMenu()
      expect(menu?.textContent).toContain('Parent')
      expect(menu?.textContent).not.toContain('Child 1')
    })

    it('renders submenu footer items', () => {
      const items: DropdownMenuItem[] = [
        {
          label: 'Parent',
          submenu: { items: [{ label: 'Child' }], footerItems: [{ label: 'Sub Footer' }] },
        },
      ]
      const container = render(<DropdownMenu items={items} trigger={<button>Open</button>} submenuBackLabel="Back" />)
      clickTrigger(container)
      clickItem('Parent')
      expect(getMenu()?.textContent).toContain('Sub Footer')
    })
  })

  // Keyboard navigation tests require useEffect to fire (keyboard listener + initial
  // selection are set up in effects). React.act doesn't flush effects in React 19,
  // so these can't be tested with unit tests. Covered by e2e tests instead.
})

describe('onOpenChange freshness', () => {
  const calls: Array<{ open: boolean; count: number }> = []

  function StaleParent() {
    const [count, setCount] = useState(0)
    return (
      <div>
        <DropdownMenu
          items={ITEMS}
          trigger={<button>Open</button>}
          isOpen
          onOpenChange={(open: boolean) => {
            calls.push({ open, count })
          }}
        />
        <button type="button" onClick={() => setCount((c) => c + 1)}>
          bump
        </button>
      </div>
    )
  }

  it('Escape invokes the latest onOpenChange, not the one captured at open', () => {
    // The file's earlier raw-root tests leak open menus (createRoot is never
    // unmounted). Their window keydown handlers also receive this Escape and
    // close against portals that the file-wide `body.innerHTML = ''` reset has
    // already wiped, so their no-op `body.removeChild` calls would otherwise
    // throw. Make removeChild tolerate a child that is already gone.
    const origRemove = document.body.removeChild.bind(document.body)
    ;(document.body as any).removeChild = (child: any) => (document.body.contains(child) ? origRemove(child) : child)
    try {
      calls.length = 0
      // Detached container: keeps the root's container out of document.body so
      // RTL's auto-cleanup unmount doesn't fight the file-wide body reset.
      const host = document.createElement('div')
      const { getByText } = rtlRender(<StaleParent />, { container: host })
      for (let i = 0; i < 3; i += 1) {
        rtlFireEvent.click(getByText('bump'))
      }
      rtlFireEvent.keyDown(window, { key: 'Escape' })
      expect(calls.length).toBeGreaterThan(0)
      expect(calls[calls.length - 1]).toEqual({ open: false, count: 3 })
    } finally {
      ;(document.body as any).removeChild = origRemove
    }
  })
})
