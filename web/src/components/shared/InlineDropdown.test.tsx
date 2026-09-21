// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { InlineDropdown, type InlineDropdownItem } from './InlineDropdown'
import { Link } from 'wouter'

vi.mock('wouter', () => ({
  Link: ({ children, href, onClick, onAuxClick, className }: any) => (
    <a href={href} onClick={onClick} onAuxClick={onAuxClick} className={className}>
      {children}
    </a>
  ),
}))

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
  return document.querySelector('[data-testid="inline-dropdown-menu"]')
}

function clickTrigger(container: HTMLElement) {
  const trigger = container.querySelector('button')
  if (!trigger) throw new Error('Trigger button not found')
  act(() => {
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

const LINK_ITEM: InlineDropdownItem = {
  label: (
    <Link href="/p/p1/s/s1" className="flex items-center gap-2">
      Session 1
    </Link>
  ),
}

const BUTTON_ITEM: InlineDropdownItem = { label: 'Button Item', onClick: vi.fn() }

const RAW_LINK_ITEM: InlineDropdownItem = { label: 'Raw Link', href: '/p/p1' }

function findLink(href: string): HTMLAnchorElement {
  const menu = getMenu()
  const link = Array.from(menu?.querySelectorAll('a') ?? []).find((a) => a.getAttribute('href') === href)
  if (!link) throw new Error(`Link "${href}" not found`)
  return link as HTMLAnchorElement
}

describe('InlineDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('opens the menu when the trigger is clicked', () => {
    const container = render(<InlineDropdown items={[LINK_ITEM]} trigger="Menu" />)
    clickTrigger(container)
    expect(getMenu()).toBeTruthy()
  })

  it('closes the menu when a link item is left-clicked', () => {
    const container = render(<InlineDropdown items={[LINK_ITEM, BUTTON_ITEM]} trigger="Menu" />)
    clickTrigger(container)
    const menu = getMenu()
    const link = menu?.querySelector('a')
    if (!link) throw new Error('Link item not found')
    act(() => {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(getMenu()).toBeNull()
  })

  it('closes the menu when a link item is middle-clicked', () => {
    const container = render(<InlineDropdown items={[LINK_ITEM, BUTTON_ITEM]} trigger="Menu" />)
    clickTrigger(container)
    const link = findLink('/p/p1/s/s1')
    act(() => {
      link.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))
    })
    expect(getMenu()).toBeNull()
  })

  it('keeps the menu open when a link item is right-clicked', () => {
    const container = render(<InlineDropdown items={[LINK_ITEM, BUTTON_ITEM]} trigger="Menu" />)
    clickTrigger(container)
    const link = findLink('/p/p1/s/s1')
    act(() => {
      link.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 2 }))
    })
    expect(getMenu()).toBeTruthy()
  })

  it('closes the menu when a raw href item is left-clicked', () => {
    const container = render(<InlineDropdown items={[RAW_LINK_ITEM, BUTTON_ITEM]} trigger="Menu" />)
    clickTrigger(container)
    const link = findLink('/p/p1')
    act(() => {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(getMenu()).toBeNull()
  })

  it('closes the menu when a raw href item is middle-clicked', () => {
    const container = render(<InlineDropdown items={[RAW_LINK_ITEM, BUTTON_ITEM]} trigger="Menu" />)
    clickTrigger(container)
    const link = findLink('/p/p1')
    act(() => {
      link.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))
    })
    expect(getMenu()).toBeNull()
  })

  it('closes the menu and calls onClick when a button item is clicked', () => {
    const container = render(<InlineDropdown items={[LINK_ITEM, BUTTON_ITEM]} trigger="Menu" />)
    clickTrigger(container)
    const menu = getMenu()
    const button = Array.from(menu?.querySelectorAll('button') ?? []).find((b) => b.textContent === 'Button Item')
    if (!button) throw new Error('Button item not found')
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(getMenu()).toBeNull()
    expect(BUTTON_ITEM.onClick).toHaveBeenCalled()
  })
})
