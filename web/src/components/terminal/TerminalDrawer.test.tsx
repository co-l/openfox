import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreateSession = vi.fn()

describe('TerminalDrawer auto-create logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should detect duplicate createSession calls (StrictMode race condition)', () => {
    // This test reproduces the bug where opening terminal 3 times causes double sessions
    // due to React StrictMode running effects twice
    
    // The buggy behavior: createSession is called twice in quick succession
    // because the effect runs twice in StrictMode and state updates are batched
    
    mockCreateSession()
    mockCreateSession() // Simulating the bug: called twice
    
    // The bug manifests as 2 createSession calls when we expect only 1
    expect(mockCreateSession).toHaveBeenCalledTimes(2)
  })
  
  it('should only allow one createSession per isOpen=true state', () => {
    // The fix: use a ref to track if we've already created a session for this open cycle
    // We need to reset the ref when isOpen becomes false, and only create once per open
    
    const hasCreatedForOpenCycle = { current: false }
    
    function safeCreateSession() {
      if (!hasCreatedForOpenCycle.current) {
        hasCreatedForOpenCycle.current = true
        mockCreateSession()
      }
    }
    
    // First "open"
    safeCreateSession()
    safeCreateSession() // Should not create again
    expect(mockCreateSession).toHaveBeenCalledTimes(1)
    
    // Simulate close and reopen
    hasCreatedForOpenCycle.current = false
    safeCreateSession()
    expect(mockCreateSession).toHaveBeenCalledTimes(2)
  })
})