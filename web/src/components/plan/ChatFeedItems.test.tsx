// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { act } from 'react'
import { ChatFeedItems } from './ChatFeedItems'
import { FEED_REVEAL_EVENT } from './feed-window'
import { SETTINGS_KEYS, useSettingsStore } from '../../stores/settings'
import type { DisplayItem } from './groupMessages'

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []
  callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    MockIntersectionObserver.instances.push(this)
  }

  observe() {}
  unobserve() {}
  disconnect() {}

  trigger() {
    this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

function msg(id: string, role: 'user' | 'assistant' = 'user', content = 'Hello'): DisplayItem {
  return {
    type: 'message',
    message: {
      id,
      role,
      content,
      timestamp: new Date().toISOString(),
      isStreaming: false,
    },
  }
}

describe('ChatFeedItems stable keys', () => {
  it('should preserve DOM node identity for shifted items', () => {
    const items = [msg('a', 'user', 'Alpha'), msg('b', 'user', 'Beta'), msg('c', 'user', 'Gamma')]

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<ChatFeedItems displayItems={items} />))
    const nodeB = container.querySelector('[data-message-id="b"]')
    expect(nodeB).toBeTruthy()
    expect(nodeB?.textContent).toContain('Beta')

    // Simulate shift: 'a' drops out, from [a,b,c] to [b,c]
    const shifted = [msg('b', 'user', 'Beta'), msg('c', 'user', 'Gamma')]
    flushSync(() => root.render(<ChatFeedItems displayItems={shifted} />))

    const nodeB2 = container.querySelector('[data-message-id="b"]')
    expect(nodeB2).toBeTruthy()
    expect(nodeB).toBe(nodeB2)
  })

  it('should re-render when message content changes', () => {
    const items = [msg('a', 'user', 'Hello'), msg('b', 'user', 'World')]

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<ChatFeedItems displayItems={items} />))
    const firstHtml = container.innerHTML

    flushSync(() =>
      root.render(<ChatFeedItems displayItems={[msg('a', 'user', 'Hello'), msg('b', 'user', 'Updated')]} />),
    )
    expect(container.innerHTML).not.toBe(firstHtml)
    expect(container.textContent).toContain('Updated')
  })

  it('keeps non-streaming message DOM intact when new message appended', () => {
    const items = [msg('a', 'user', 'First'), msg('b', 'user', 'Second')]

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<ChatFeedItems displayItems={items} />))
    const nodeA = container.querySelector('[data-message-id="a"]')
    const nodeB = container.querySelector('[data-message-id="b"]')

    const items2 = [msg('a', 'user', 'First'), msg('b', 'user', 'Second'), msg('c', 'user', 'Third')]
    flushSync(() => root.render(<ChatFeedItems displayItems={items2} />))

    expect(container.querySelector('[data-message-id="a"]')).toBe(nodeA)
    expect(container.querySelector('[data-message-id="b"]')).toBe(nodeB)
    expect(container.textContent).toContain('Third')
  })
})

describe('ChatFeedItems paginated-history virtualization', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: {} })
  })

  it('preserves the full feed when virtualization is disabled', () => {
    const items = Array.from({ length: 20 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<ChatFeedItems displayItems={items} />))

    expect(container.querySelector('[data-message-id="m0"]')).toBeTruthy()
    expect(container.querySelector('[data-message-id="m19"]')).toBeTruthy()
    expect(container.querySelectorAll('.feed-item')).toHaveLength(20)
    expect(container.querySelector('[data-placeholder]')).toBeNull()
    expect(container.querySelector('[data-testid="feed-sentinel"]')).toBeNull()
    expect(container.querySelector('[data-testid="feed-unmounted-hint"]')).toBeNull()
  })

  it('mounts only four recent items for paginated history', () => {
    const items = Array.from({ length: 20 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<ChatFeedItems displayItems={items} paginatedHistory />))

    expect(container.querySelector('[data-message-id="m15"]')).toBeNull()
    expect(container.querySelector('[data-message-id="m16"]')).toBeTruthy()
    expect(container.querySelector('[data-message-id="m19"]')).toBeTruthy()
    expect(container.querySelectorAll('.feed-item')).toHaveLength(4)
    expect(container.querySelectorAll('[data-placeholder]')).toHaveLength(16)
  })
})

describe('ChatFeedItems containment styling', () => {
  it('applies no content-visibility containment to mounted items when virtualization is off', () => {
    useSettingsStore.setState({ settings: {} })
    const items = [msg('a', 'user', 'Alpha'), msg('b', 'assistant', 'Beta')]

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<ChatFeedItems displayItems={items} />))

    const wrappers = container.querySelectorAll<HTMLElement>('[data-item-index]:not([data-placeholder])')
    expect(wrappers.length).toBeGreaterThan(0)
    for (const wrapper of wrappers) {
      expect(wrapper.style.getPropertyValue('content-visibility')).toBe('')
      expect(wrapper.style.getPropertyValue('contain-intrinsic-size')).toBe('')
    }
  })

  it('applies content-visibility containment to mounted items when virtualization is on', () => {
    useSettingsStore.setState({ settings: { [SETTINGS_KEYS.DISPLAY_FEED_VIRTUALIZATION]: 'true' } })
    const items = Array.from({ length: 34 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<ChatFeedItems displayItems={items} />))

    const wrappers = container.querySelectorAll<HTMLElement>('[data-item-index]:not([data-placeholder])')
    expect(wrappers.length).toBeGreaterThan(0)
    for (const wrapper of wrappers) {
      expect(wrapper.style.getPropertyValue('content-visibility')).toBe('auto')
      expect(wrapper.style.getPropertyValue('contain-intrinsic-size')).toBe('auto 200px')
    }
  })
})

describe('ChatFeedItems progressive rendering', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: { [SETTINGS_KEYS.DISPLAY_FEED_VIRTUALIZATION]: 'true' } })
    MockIntersectionObserver.instances = []
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mounts only the most recent items first', () => {
    const items = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<ChatFeedItems displayItems={items} />))

    // Only the 30 most recent are mounted: m40..m69
    expect(container.querySelector('[data-message-id="m0"]')).toBeNull()
    expect(container.querySelector('[data-message-id="m39"]')).toBeNull()
    expect(container.querySelector('[data-message-id="m40"]')).toBeTruthy()
    expect(container.querySelector('[data-message-id="m69"]')).toBeTruthy()
    expect(container.querySelectorAll('.feed-item')).toHaveLength(30)
    // The rest are unmounted placeholders
    expect(container.querySelectorAll('[data-placeholder]')).toHaveLength(40)
  })

  it('reveals older items in batches when the sentinel becomes visible', () => {
    const items = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const scrollListeners: Array<() => void> = []
    const wheelListeners: Array<(event: WheelEvent) => void> = []
    const viewport = {
      scrollTop: 500,
      addEventListener: (type: string, cb: (event: WheelEvent) => void) => {
        if (type === 'scroll') scrollListeners.push(cb as () => void)
        if (type === 'wheel') wheelListeners.push(cb)
      },
      removeEventListener: () => {},
    }
    const scrollContainerRef = {
      current: {
        osInstance: () => ({ elements: () => ({ viewport }) }),
        getElement: () => null,
      },
    } as never

    flushSync(() => root.render(<ChatFeedItems displayItems={items} scrollContainerRef={scrollContainerRef} />))
    expect(container.querySelectorAll('.feed-item')).toHaveLength(30)
    expect(container.querySelector('[data-testid="feed-sentinel"]')).toBeTruthy()

    // Intersection alone must not reveal history during initial bottom anchoring.
    act(() => {
      MockIntersectionObserver.instances.at(-1)!.trigger()
    })
    expect(container.querySelectorAll('.feed-item')).toHaveLength(30)

    // Once the viewport moves upward, each reveal moves the window by 20 items.
    act(() => {
      for (const cb of wheelListeners) cb({ deltaY: -100 } as WheelEvent)
      viewport.scrollTop = 400
      for (const cb of scrollListeners) cb()
      MockIntersectionObserver.instances.at(-1)!.trigger()
    })
    expect(container.querySelectorAll('.feed-item')).toHaveLength(50)
    expect(container.querySelector('[data-message-id="m20"]')).toBeTruthy()

    act(() => {
      MockIntersectionObserver.instances.at(-1)!.trigger()
    })
    expect(container.querySelectorAll('.feed-item')).toHaveLength(70)
    expect(container.querySelector('[data-message-id="m0"]')).toBeTruthy()
    expect(container.querySelector('[data-placeholder]')).toBeNull()
    expect(container.querySelector('[data-testid="feed-sentinel"]')).toBeNull()
  })

  it('reveals up to a target index on the feed reveal event', () => {
    const items = Array.from({ length: 100 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<ChatFeedItems displayItems={items} />))
    expect(container.querySelectorAll('.feed-item')).toHaveLength(30)

    // Timeline navigation targets index 10 — everything up to it is revealed
    act(() => {
      window.dispatchEvent(new CustomEvent(FEED_REVEAL_EVENT, { detail: { index: 10 } }))
    })
    expect(container.querySelector('[data-message-id="m0"]')).toBeTruthy()
    expect(container.querySelectorAll('.feed-item')).toHaveLength(100)
  })

  it('keeps the window stable when new items are appended', () => {
    const items = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<ChatFeedItems displayItems={items} />))
    const nodeM69 = container.querySelector('[data-message-id="m69"]')

    const items2 = [...items, msg('m70', 'user', 'Newest')]
    flushSync(() => root.render(<ChatFeedItems displayItems={items2} />))

    // Newest item is mounted, previously mounted items keep their identity
    expect(container.querySelector('[data-message-id="m70"]')).toBeTruthy()
    expect(container.querySelector('[data-message-id="m69"]')).toBe(nodeM69)
    expect(container.querySelectorAll('.feed-item')).toHaveLength(31)
  })

  it('re-anchors to the latest window when a large batch arrives (initial load)', () => {
    const items = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    // Session arrives in chunks, like the real WS/REST load flow
    flushSync(() => root.render(<ChatFeedItems displayItems={items.slice(0, 16)} />))
    expect(container.querySelectorAll('.feed-item')).toHaveLength(16)

    act(() => {
      root.render(<ChatFeedItems displayItems={items} />)
    })
    // Bulk append re-anchors the window: only the 30 most recent are mounted
    expect(container.querySelectorAll('.feed-item')).toHaveLength(30)
    expect(container.querySelector('[data-message-id="m40"]')).toBeTruthy()
    expect(container.querySelector('[data-message-id="m0"]')).toBeNull()
    expect(container.querySelectorAll('[data-placeholder]')).toHaveLength(40)
  })

  it('resets userScrolled state when sessionId changes', () => {
    const items = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const scrollListeners: Array<() => void> = []
    const wheelListeners: Array<(event: WheelEvent) => void> = []
    const viewport = {
      scrollTop: 0,
      addEventListener: (type: string, cb: (event: WheelEvent) => void) => {
        if (type === 'scroll') scrollListeners.push(cb as () => void)
        if (type === 'wheel') wheelListeners.push(cb)
      },
      removeEventListener: () => {},
    }
    const scrollContainerRef = {
      current: {
        osInstance: () => ({ elements: () => ({ viewport }) }),
        getElement: () => null,
      },
    } as never

    // Load session A and simulate user scrolling into history
    flushSync(() =>
      root.render(
        <ChatFeedItems
          displayItems={items.slice(0, 16)}
          sessionId="session-a"
          scrollContainerRef={scrollContainerRef}
        />,
      ),
    )
    act(() => {
      root.render(<ChatFeedItems displayItems={items} sessionId="session-a" scrollContainerRef={scrollContainerRef} />)
    })
    act(() => {
      viewport.scrollTop = 500
      for (const cb of scrollListeners) cb()
      viewport.scrollTop = 400
      for (const cb of scrollListeners) cb()
      MockIntersectionObserver.instances.at(-1)!.trigger()
      MockIntersectionObserver.instances.at(-1)!.trigger()
    })
    expect(container.querySelectorAll('.feed-item')).toHaveLength(70)

    // Switch to session B — userScrolled must be reset; window re-anchors
    const itemsB = Array.from({ length: 70 }, (_, i) => msg(`b${i}`, 'user', `B ${i}`))
    act(() => {
      root.render(<ChatFeedItems displayItems={itemsB} sessionId="session-b" scrollContainerRef={scrollContainerRef} />)
    })
    expect(container.querySelectorAll('.feed-item')).toHaveLength(30)
    expect(container.querySelector('[data-message-id="b69"]')).toBeTruthy()
    expect(container.querySelector('[data-message-id="b0"]')).toBeNull()

    // A bulk batch on session B also re-anchors (userScrolled was reset)
    const bigBatch = Array.from({ length: 100 }, (_, i) => msg(`b${i}`, 'user', `B ${i}`))
    act(() => {
      root.render(
        <ChatFeedItems displayItems={bigBatch} sessionId="session-b" scrollContainerRef={scrollContainerRef} />,
      )
    })
    expect(container.querySelectorAll('.feed-item')).toHaveLength(30)
    expect(container.querySelector('[data-message-id="b99"]')).toBeTruthy()
    expect(container.querySelector('[data-message-id="b0"]')).toBeNull()
  })

  it('does not re-anchor when the user has scrolled into history (reconnect replay)', () => {
    const items = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    // OS viewport mock: scrollTop > 4 means the user scrolled up
    const scrollListeners: Array<() => void> = []
    const wheelListeners: Array<(event: WheelEvent) => void> = []
    const viewport = {
      scrollTop: 0,
      addEventListener: (type: string, cb: (event: WheelEvent) => void) => {
        if (type === 'scroll') scrollListeners.push(cb as () => void)
        if (type === 'wheel') wheelListeners.push(cb)
      },
      removeEventListener: () => {},
    }
    const scrollContainerRef = {
      current: {
        osInstance: () => ({ elements: () => ({ viewport }) }),
        getElement: () => null,
      },
    } as never

    // Initial load re-anchors to the bottom
    flushSync(() =>
      root.render(<ChatFeedItems displayItems={items.slice(0, 16)} scrollContainerRef={scrollContainerRef} />),
    )
    act(() => {
      root.render(<ChatFeedItems displayItems={items} scrollContainerRef={scrollContainerRef} />)
    })
    expect(container.querySelectorAll('.feed-item')).toHaveLength(30)

    // User scrolls up (fires the scroll listener) and reveals everything
    act(() => {
      viewport.scrollTop = 500
      for (const cb of scrollListeners) cb()
      viewport.scrollTop = 400
      for (const cb of scrollListeners) cb()
      MockIntersectionObserver.instances.at(-1)!.trigger()
      MockIntersectionObserver.instances.at(-1)!.trigger()
    })
    expect(container.querySelectorAll('.feed-item')).toHaveLength(70)
    expect(container.querySelector('[data-message-id="m0"]')).toBeTruthy()

    // Reconnect replay delivers a large batch — the window must NOT jump back down
    const replayItems = Array.from({ length: 100 }, (_, i) => msg(`r${i}`, 'user', `Replay ${i}`))
    act(() => {
      root.render(<ChatFeedItems displayItems={replayItems} scrollContainerRef={scrollContainerRef} />)
    })
    // Window stays anchored at the top: all 100 items mounted, no placeholders
    expect(container.querySelectorAll('.feed-item')).toHaveLength(100)
    expect(container.querySelector('[data-message-id="r0"]')).toBeTruthy()
    expect(container.querySelector('[data-placeholder]')).toBeNull()
  })
})
