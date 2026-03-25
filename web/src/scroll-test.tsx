import React, { useState, useRef, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom/client'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'

/**
 * Scroll Test Harness
 *
 * Simulates the PlanPanel chat feed with Virtuoso to test scroll behavior.
 * Controls:
 * - "Add Item" — append a new message (simulates new message arriving)
 * - "Start Streaming" — grow the last item's content every 60ms (simulates rAF-batched streaming)
 * - "Stop Streaming" — stop growing
 * - "Add Sub-Agent" — add a tall block (simulates sub-agent container appearing)
 *
 * The scroll logic here MUST match PlanPanel.tsx exactly.
 * If tests pass here, port the logic back.
 */

interface Item {
  id: number
  content: string
  type: 'message' | 'subagent'
}

let nextId = 1
function makeItem(type: 'message' | 'subagent' = 'message', lines = 3): Item {
  const id = nextId++
  const content = Array.from({ length: lines }, (_, i) => `Line ${i + 1} of item ${id}`).join('\n')
  return { id, content, type }
}

function ScrollTestApp() {
  const [items, setItems] = useState<Item[]>(() =>
    Array.from({ length: 30 }, () => makeItem('message', Math.floor(Math.random() * 8) + 2))
  )
  const [streamingItem, setStreamingItem] = useState<Item | null>(null)
  const streamingRef = useRef(false)
  const streamIntervalRef = useRef<number | null>(null)

  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const atBottomRef = useRef(true)

  // Merge streaming item into items for display (same pattern as PlanPanel)
  const displayItems = React.useMemo(() => {
    if (!streamingItem) return items
    return items.map(item => item.id === streamingItem.id ? streamingItem : item)
  }, [items, streamingItem])

  // === SCROLL LOGIC (must match PlanPanel.tsx) ===
  //
  // Strategy: a persistent MutationObserver catches ALL Virtuoso async renders
  // (initial load, streaming content growth, new items, sub-agents).
  // A scroll listener tracks if user is at bottom.
  // A wheel listener prevents the feedback loop: wheel fires synchronously
  // BEFORE any DOM mutations, so we can suppress the observer during user scrolls.
  useEffect(() => {
    const scroller = document.querySelector('[data-virtuoso-scroller]') as HTMLElement | null
    if (!scroller) return

    const THRESHOLD = 150
    let userScrolling = false

    const isNearBottom = () =>
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < THRESHOLD

    // Scroll listener: update atBottom state
    const onScroll = () => {
      atBottomRef.current = isNearBottom()
    }

    // Wheel listener: fires synchronously before DOM mutations.
    // Suppresses the observer from snapping back during user scrolls.
    const onWheel = () => {
      userScrolling = true
      requestAnimationFrame(() => { userScrolling = false })
    }

    // Touch support: same guard for touch scrolling
    const onTouchStart = () => {
      userScrolling = true
    }
    const onTouchEnd = () => {
      requestAnimationFrame(() => { userScrolling = false })
    }

    // Persistent observer: scroll to bottom on any DOM change when pinned.
    // Uses atBottomRef (captures state before mutation) + wheel guard (prevents
    // feedback loop during real user scrolls).
    const observer = new MutationObserver(() => {
      if (atBottomRef.current && !userScrolling) {
        scroller.scrollTop = scroller.scrollHeight
      }
    })

    scroller.addEventListener('scroll', onScroll, { passive: true })
    scroller.addEventListener('wheel', onWheel, { passive: true })
    scroller.addEventListener('touchstart', onTouchStart, { passive: true })
    scroller.addEventListener('touchend', onTouchEnd, { passive: true })
    observer.observe(scroller, { childList: true, subtree: true })

    // Initial scroll
    scroller.scrollTop = scroller.scrollHeight
    atBottomRef.current = true

    return () => {
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('wheel', onWheel)
      scroller.removeEventListener('touchstart', onTouchStart)
      scroller.removeEventListener('touchend', onTouchEnd)
      observer.disconnect()
    }
  }, []) // session?.id equivalent — only one "session" in test

  // === END SCROLL LOGIC ===

  const addItem = useCallback(() => {
    setItems(prev => [...prev, makeItem('message', Math.floor(Math.random() * 8) + 2)])
  }, [])

  const addSubAgent = useCallback(() => {
    setItems(prev => [...prev, makeItem('subagent', 15)])
  }, [])

  const startStreaming = useCallback(() => {
    if (streamingRef.current) return
    streamingRef.current = true
    // Create or use last item as streaming target
    setItems(prev => {
      const last = prev[prev.length - 1]
      setStreamingItem({ ...last })
      return prev
    })
    let counter = 0
    streamIntervalRef.current = window.setInterval(() => {
      counter++
      setStreamingItem(prev => {
        if (!prev) return prev
        return { ...prev, content: prev.content + `\nStreaming line ${counter}...` }
      })
    }, 60) // ~16fps, matching rAF batching
  }, [])

  const stopStreaming = useCallback(() => {
    streamingRef.current = false
    if (streamIntervalRef.current !== null) {
      clearInterval(streamIntervalRef.current)
      streamIntervalRef.current = null
    }
    // Fold streaming item back into items (like chat.done)
    setStreamingItem(prev => {
      if (prev) {
        setItems(items => items.map(item => item.id === prev.id ? prev : item))
      }
      return null
    })
  }, [])

  // Expose test helpers on window for Playwright
  useEffect(() => {
    ;(window as any).__scrollTest = {
      getScrollState: () => {
        const el = document.querySelector('[data-virtuoso-scroller]') as HTMLElement
        return {
          scrollTop: Math.round(el.scrollTop),
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          dist: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
          atBottom: atBottomRef.current,
        }
      },
      addItem,
      addSubAgent,
      startStreaming,
      stopStreaming,
      scrollUp: (px: number) => {
        const el = document.querySelector('[data-virtuoso-scroller]') as HTMLElement
        // Dispatch wheel event first (like a real user scroll) to trigger the
        // userScrolling guard, preventing the MutationObserver snap-back.
        el.dispatchEvent(new WheelEvent('wheel', { deltaY: -px, bubbles: true }))
        el.scrollTop -= px
      },
      scrollToBottom: () => {
        const el = document.querySelector('[data-virtuoso-scroller]') as HTMLElement
        el.scrollTop = el.scrollHeight
      },
    }
    return () => { delete (window as any).__scrollTest }
  }, [addItem, addSubAgent, startStreaming, stopStreaming])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Controls */}
      <div id="controls" style={{ padding: '8px 12px', background: '#16213e', borderBottom: '1px solid #333', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        <button onClick={addItem} style={btnStyle}>Add Item</button>
        <button onClick={addSubAgent} style={btnStyle}>Add Sub-Agent</button>
        <button onClick={startStreaming} style={{ ...btnStyle, background: '#2d6a4f' }}>Start Streaming</button>
        <button onClick={stopStreaming} style={{ ...btnStyle, background: '#9b2226' }}>Stop Streaming</button>
        <span id="status" style={{ marginLeft: 'auto', fontSize: 12, color: '#aaa' }}>
          Items: {displayItems.length} | atBottom: {String(atBottomRef.current)}
        </span>
      </div>

      {/* Virtuoso list — same props as PlanPanel */}
      <Virtuoso
        ref={virtuosoRef}
        data={displayItems}
        style={{ flex: 1 }}
        increaseViewportBy={{ top: 500, bottom: 200 }}
        defaultItemHeight={120}
        itemContent={(_index, item) => (
          <div style={{
            padding: '12px 16px',
            margin: '4px 8px',
            background: item.type === 'subagent' ? '#1a3a5c' : '#0f3460',
            borderRadius: 6,
            border: '1px solid #333',
            whiteSpace: 'pre-wrap',
            fontSize: 13,
            lineHeight: 1.5,
          }}>
            <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>
              {item.type === 'subagent' ? '🤖 Sub-Agent' : '💬 Message'} #{item.id}
            </div>
            {item.content}
          </div>
        )}
        components={{
          Header: () => <div style={{ height: 16 }} />,
          Footer: () => <div style={{ height: 16 }} />,
        }}
      />
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '4px 12px',
  background: '#1a3a5c',
  color: '#eee',
  border: '1px solid #555',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'monospace',
}

ReactDOM.createRoot(document.getElementById('root')!).render(<ScrollTestApp />)
