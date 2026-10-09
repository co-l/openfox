// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { act } from 'react'
import { ChatFeedItems } from './ChatFeedItems'
import { FEED_REVEAL_EVENT } from './feed-window'
import { SETTINGS_KEYS, settingResource } from '../../lib/resources'
import { clearCache } from '../../lib/resourceCache'
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

/**
 * A real element as the OverlayScrollbars viewport, so a dispatched scroll event
 * travels document → target and reaches the capture listener the component
 * installs. `scrollTop` is defined directly: happy-dom clamps it on elements
 * that cannot actually scroll.
 */
function makeViewportMock() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const viewport = document.createElement('div')
  host.appendChild(viewport)

  return {
    viewport,
    scrollContainerRef: {
      current: {
        osInstance: () => ({ elements: () => ({ viewport }) }),
        getElement: () => host,
      },
    } as never,
    scrollTo(top: number) {
      Object.defineProperty(viewport, 'scrollTop', { value: top, writable: true, configurable: true })
      viewport.dispatchEvent(new Event('scroll'))
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

vi.mock('../../lib/api', () => ({ authFetch: vi.fn() }))

describe('ChatFeedItems default (virtualization off)', () => {
  beforeEach(() => {
    clearCache()
    settingResource.write('false', SETTINGS_KEYS.DISPLAY_FEED_VIRTUALIZATION)
  })

  it('mounts every item with no placeholders or sentinel when explicitly disabled', () => {
    const items = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<ChatFeedItems displayItems={items} />))

    expect(container.querySelector('[data-message-id="m0"]')).toBeTruthy()
    expect(container.querySelector('[data-message-id="m69"]')).toBeTruthy()
    expect(container.querySelectorAll('.feed-item')).toHaveLength(70)
    expect(container.querySelector('[data-placeholder]')).toBeNull()
    expect(container.querySelector('[data-testid="feed-sentinel"]')).toBeNull()
    expect(container.querySelector('[data-testid="feed-unmounted-hint"]')).toBeNull()
  })
})

describe('ChatFeedItems defaults', () => {
  beforeEach(() => {
    clearCache()
  })

  it('virtualizes when the setting has never been written', () => {
    const items = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<ChatFeedItems displayItems={items} />))

    // Feed virtualization is on by default: a fresh install mounts the window,
    // not the whole feed.
    expect(container.querySelector('[data-message-id="m69"]')).toBeTruthy()
    expect(container.querySelector('[data-message-id="m0"]')).toBeNull()
    expect(container.querySelectorAll('[data-item-index]:not([data-placeholder])')).toHaveLength(30)
    expect(container.querySelectorAll('[data-placeholder]')).toHaveLength(40)
  })
})

describe('ChatFeedItems containment styling', () => {
  it('applies no content-visibility containment to mounted items when virtualization is off', () => {
    clearCache()
    settingResource.write('false', SETTINGS_KEYS.DISPLAY_FEED_VIRTUALIZATION)
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
    clearCache()
    settingResource.write('true', SETTINGS_KEYS.DISPLAY_FEED_VIRTUALIZATION)
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

describe('ChatFeedItems virtualization override', () => {
  beforeEach(() => {
    clearCache()
    settingResource.write('true', SETTINGS_KEYS.DISPLAY_FEED_VIRTUALIZATION)
    MockIntersectionObserver.instances = []
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mounts every item with no hint, placeholders or sentinel when virtualization is forced off', () => {
    const items = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<ChatFeedItems displayItems={items} virtualization={false} />))

    expect(container.querySelector('[data-message-id="m0"]')).toBeTruthy()
    expect(container.querySelector('[data-message-id="m69"]')).toBeTruthy()
    expect(container.querySelectorAll('.feed-item')).toHaveLength(70)
    expect(container.querySelector('[data-testid="feed-unmounted-hint"]')).toBeNull()
    expect(container.querySelector('[data-placeholder]')).toBeNull()
    expect(container.querySelector('[data-testid="feed-sentinel"]')).toBeNull()
    expect(MockIntersectionObserver.instances).toHaveLength(0)
  })

  it('keeps content-visibility containment on mounted items when virtualization is forced off', () => {
    const items = Array.from({ length: 40 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<ChatFeedItems displayItems={items} virtualization={false} />))

    const wrappers = container.querySelectorAll<HTMLElement>('[data-item-index]:not([data-placeholder])')
    expect(wrappers.length).toBe(40)
    for (const wrapper of wrappers) {
      expect(wrapper.style.getPropertyValue('content-visibility')).toBe('auto')
      expect(wrapper.style.getPropertyValue('contain-intrinsic-size')).toBe('auto 200px')
    }
  })
})

describe('ChatFeedItems progressive rendering', () => {
  beforeEach(() => {
    clearCache()
    settingResource.write('true', SETTINGS_KEYS.DISPLAY_FEED_VIRTUALIZATION)
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

    flushSync(() => root.render(<ChatFeedItems displayItems={items} />))
    expect(container.querySelectorAll('.feed-item')).toHaveLength(30)
    expect(container.querySelector('[data-testid="feed-sentinel"]')).toBeTruthy()

    // Each reveal moves the window up by 20 items
    act(() => {
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

  it('establishes the window when a session streams from empty, one item at a time', () => {
    const items = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    // A session opened before its first message: the feed starts empty and
    // grows by single appends, never by a bulk load.
    flushSync(() => root.render(<ChatFeedItems displayItems={[]} />))
    for (let count = 1; count <= items.length; count++) {
      act(() => {
        root.render(<ChatFeedItems displayItems={items.slice(0, count)} />)
      })
    }

    const mounted = container.querySelectorAll('[data-item-index]:not([data-placeholder])')
    expect(mounted).toHaveLength(30)
    expect(container.querySelector('[data-message-id="m40"]')).toBeTruthy()
    expect(container.querySelector('[data-message-id="m69"]')).toBeTruthy()
    expect(container.querySelector('[data-message-id="m39"]')).toBeNull()
    expect(container.querySelectorAll('[data-placeholder]')).toHaveLength(40)
  })

  it('keeps the window pinned to the most recent items while following the stream', () => {
    const items = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<ChatFeedItems displayItems={items} />))
    const nodeM69 = container.querySelector('[data-message-id="m69"]')

    const items2 = [...items, msg('m70', 'user', 'Newest')]
    act(() => {
      root.render(<ChatFeedItems displayItems={items2} />)
    })

    // Newest item is mounted, still-mounted items keep their identity, and the
    // window does not grow past the initial render count.
    expect(container.querySelector('[data-message-id="m70"]')).toBeTruthy()
    expect(container.querySelector('[data-message-id="m69"]')).toBe(nodeM69)
    expect(container.querySelector('[data-message-id="m40"]')).toBeNull()
    expect(container.querySelectorAll('[data-item-index]:not([data-placeholder])')).toHaveLength(30)
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

    const { scrollContainerRef, scrollTo } = makeViewportMock()

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
      scrollTo(500)
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

    // A bulk batch on session B re-anchors: the new session starts pinned to
    // the bottom, so the window is free to follow it.
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

  it('reveals older items once the feed gets close to the top', () => {
    const items = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const { scrollContainerRef, scrollTo } = makeViewportMock()

    flushSync(() => root.render(<ChatFeedItems displayItems={items} scrollContainerRef={scrollContainerRef} />))
    expect(container.querySelectorAll('[data-placeholder]')).toHaveLength(40)

    // Approaching the top must reveal — waiting for scrollTop to hit exactly 0
    // means traversing every placeholder first, and the unmounted hint is
    // visible long before that.
    act(() => {
      scrollTo(120)
    })

    expect(container.querySelectorAll('[data-placeholder]')).toHaveLength(20)
    expect(container.querySelector('[data-message-id="m20"]')).toBeTruthy()
  })

  it('stays put while the feed is far from the top', () => {
    const items = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const { scrollContainerRef, scrollTo } = makeViewportMock()

    flushSync(() => root.render(<ChatFeedItems displayItems={items} scrollContainerRef={scrollContainerRef} />))

    act(() => {
      scrollTo(4000)
    })

    expect(container.querySelectorAll('[data-placeholder]')).toHaveLength(40)
    expect(container.querySelector('[data-message-id="m0"]')).toBeNull()
  })

  it('attaches its scroll listener even though the OverlayScrollbars instance is not ready yet', () => {
    const items = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    // The feed's ScrollArea creates its instance in a passive effect, and React
    // runs child effects first — so the instance is undefined when this
    // component's effects run. Reading it while attaching used to leave the
    // listener permanently unattached, which is what made "scroll to the top"
    // do nothing at all.
    const host = document.createElement('div')
    document.body.appendChild(host)
    const viewport = document.createElement('div')
    host.appendChild(viewport)
    let ready = false
    const scrollContainerRef = {
      current: {
        osInstance: () => (ready ? { elements: () => ({ viewport }) } : undefined),
        getElement: () => host,
      },
    } as never

    flushSync(() => root.render(<ChatFeedItems displayItems={items} scrollContainerRef={scrollContainerRef} />))

    ready = true
    act(() => {
      Object.defineProperty(viewport, 'scrollTop', { value: 100, writable: true, configurable: true })
      viewport.dispatchEvent(new Event('scroll'))
    })

    expect(container.querySelectorAll('[data-placeholder]')).toHaveLength(20)
  })
  it('top-anchored: mounts the earliest items first', () => {
    const items = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<ChatFeedItems displayItems={items} anchored="top" />))

    // Only the 30 earliest are mounted: m0..m29
    expect(container.querySelector('[data-message-id="m0"]')).toBeTruthy()
    expect(container.querySelector('[data-message-id="m29"]')).toBeTruthy()
    expect(container.querySelector('[data-message-id="m30"]')).toBeNull()
    expect(container.querySelector('[data-message-id="m69"]')).toBeNull()
    expect(container.querySelectorAll('.feed-item')).toHaveLength(30)
    expect(container.querySelectorAll('[data-placeholder]')).toHaveLength(40)
    expect(container.querySelector('[data-testid="feed-unmounted-hint-newer"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="feed-sentinel-newer"]')).toBeTruthy()
  })

  it('top-anchored: reveals newer items in batches when the bottom sentinel becomes visible', () => {
    const items = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<ChatFeedItems displayItems={items} anchored="top" />))
    expect(container.querySelectorAll('.feed-item')).toHaveLength(30)

    act(() => {
      MockIntersectionObserver.instances.at(-1)!.trigger()
    })
    expect(container.querySelectorAll('.feed-item')).toHaveLength(50)
    expect(container.querySelector('[data-message-id="m30"]')).toBeTruthy()

    act(() => {
      MockIntersectionObserver.instances.at(-1)!.trigger()
    })
    expect(container.querySelectorAll('.feed-item')).toHaveLength(70)
    expect(container.querySelector('[data-message-id="m69"]')).toBeTruthy()
    expect(container.querySelector('[data-placeholder]')).toBeNull()
    expect(container.querySelector('[data-testid="feed-sentinel-newer"]')).toBeNull()
  })

  it('top-anchored: reveals up to a target index on the feed reveal event', () => {
    const items = Array.from({ length: 100 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<ChatFeedItems displayItems={items} anchored="top" />))
    expect(container.querySelectorAll('.feed-item')).toHaveLength(30)

    act(() => {
      window.dispatchEvent(new CustomEvent(FEED_REVEAL_EVENT, { detail: { index: 80 } }))
    })
    expect(container.querySelector('[data-message-id="m80"]')).toBeTruthy()
    expect(container.querySelectorAll('.feed-item')).toHaveLength(91)
  })

  it('top-anchored: resets the window when the session changes', () => {
    const items = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<ChatFeedItems displayItems={items} anchored="top" sessionId="session-a" />))
    expect(container.querySelectorAll('.feed-item')).toHaveLength(30)

    const itemsB = Array.from({ length: 200 }, (_, i) => msg(`b${i}`, 'user', `B ${i}`))
    act(() => {
      root.render(<ChatFeedItems displayItems={itemsB} anchored="top" sessionId="session-b" />)
    })
    expect(container.querySelectorAll('.feed-item')).toHaveLength(30)
    expect(container.querySelector('[data-message-id="b0"]')).toBeTruthy()
    expect(container.querySelector('[data-message-id="b30"]')).toBeNull()
  })

  it('top-anchored: stays bounded when items grow (new items wait behind the reveal)', () => {
    const items = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<ChatFeedItems displayItems={items.slice(0, 10)} anchored="top" />))
    expect(container.querySelectorAll('[data-item-index]:not([data-placeholder])')).toHaveLength(10)

    const grown = [...items, msg('m70', 'user', 'Newest')]
    act(() => {
      root.render(<ChatFeedItems displayItems={grown} anchored="top" />)
    })
    // The window does not grow past the initial render count.
    expect(container.querySelectorAll('[data-item-index]:not([data-placeholder])')).toHaveLength(30)
    expect(container.querySelector('[data-message-id="m0"]')).toBeTruthy()
    expect(container.querySelector('[data-message-id="m30"]')).toBeNull()
  })

  it('top-anchored: reveals when the viewport gets close to the bottom', () => {
    const items = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const { scrollContainerRef, scrollTo } = makeViewportMock()

    flushSync(() =>
      root.render(<ChatFeedItems displayItems={items} anchored="top" scrollContainerRef={scrollContainerRef} />),
    )
    expect(container.querySelectorAll('[data-placeholder]')).toHaveLength(40)

    // The mock viewport reports a zero scroll box, so it is always "near the
    // bottom" — enough to prove the reveal path fires from scroll events.
    act(() => {
      scrollTo(0)
    })

    expect(container.querySelectorAll('[data-placeholder]')).toHaveLength(20)
    expect(container.querySelector('[data-message-id="m30"]')).toBeTruthy()
  })

  it('does not re-anchor while auto-scroll is off (user reading history)', () => {
    const items = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, 'user', `Content ${i}`))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    // OS viewport mock for the reveal paths (scroll to the top reveals more).
    const { scrollContainerRef, scrollTo } = makeViewportMock()

    // Initial load re-anchors to the bottom while auto-scroll is active
    flushSync(() =>
      root.render(<ChatFeedItems displayItems={items.slice(0, 16)} scrollContainerRef={scrollContainerRef} />),
    )
    act(() => {
      root.render(<ChatFeedItems displayItems={items} scrollContainerRef={scrollContainerRef} />)
    })
    expect(container.querySelectorAll('.feed-item')).toHaveLength(30)

    // User scrolls up: auto-scroll switches itself off, and the feed reveals
    // history as they reach the top.
    act(() => {
      scrollTo(500)
      root.render(
        <ChatFeedItems displayItems={items} scrollContainerRef={scrollContainerRef} isAutoScrollActive={false} />,
      )
    })
    act(() => {
      MockIntersectionObserver.instances.at(-1)!.trigger()
      MockIntersectionObserver.instances.at(-1)!.trigger()
    })
    expect(container.querySelectorAll('.feed-item')).toHaveLength(70)
    expect(container.querySelector('[data-message-id="m0"]')).toBeTruthy()

    // Reconnect replay delivers a large batch — the window must NOT jump back down
    const replayItems = Array.from({ length: 100 }, (_, i) => msg(`r${i}`, 'user', `Replay ${i}`))
    act(() => {
      root.render(
        <ChatFeedItems displayItems={replayItems} scrollContainerRef={scrollContainerRef} isAutoScrollActive={false} />,
      )
    })
    // Window stays anchored at the top: all 100 items mounted, no placeholders
    expect(container.querySelectorAll('.feed-item')).toHaveLength(100)
    expect(container.querySelector('[data-message-id="r0"]')).toBeTruthy()
    expect(container.querySelector('[data-placeholder]')).toBeNull()
  })
})
