// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  isSplitRoute,
  readSplitLayout,
  writeSplitLayout,
  readSplitLayoutMode,
  writeSplitLayoutMode,
  SPLIT_ROUTE,
} from './splitPersistence'

const KEY = 'openfox:split'

describe('splitPersistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    history.replaceState(null, '', '/')
  })

  it('round-trips the layout through localStorage', () => {
    writeSplitLayout({ openSessionIds: ['s1', 's2'], focusedSessionId: 's2' })
    expect(readSplitLayout()).toEqual({ openSessionIds: ['s1', 's2'], focusedSessionId: 's2' })
  })

  it('clears the key when the layout is emptied', () => {
    writeSplitLayout({ openSessionIds: ['s1'], focusedSessionId: 's1' })
    writeSplitLayout({ openSessionIds: [], focusedSessionId: null })
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(readSplitLayout()).toBeNull()
  })

  it('returns null for corrupt or malformed stored data', () => {
    localStorage.setItem(KEY, '{not json')
    expect(readSplitLayout()).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ openSessionIds: 'nope' }))
    expect(readSplitLayout()).toBeNull()
  })

  it('detects the split-view route by pathname', () => {
    history.replaceState(null, '', SPLIT_ROUTE)
    expect(isSplitRoute()).toBe(true)
    history.replaceState(null, '', '/')
    expect(isSplitRoute()).toBe(false)
    history.replaceState(null, '', `/p/p1/s/s1?split=1`)
    expect(isSplitRoute()).toBe(false)
  })

  it('persists the pane layout mode with a columns default', () => {
    expect(readSplitLayoutMode()).toBe('columns')
    writeSplitLayoutMode('grid')
    expect(readSplitLayoutMode()).toBe('grid')
    writeSplitLayoutMode('columns')
    expect(readSplitLayoutMode()).toBe('columns')
    localStorage.setItem('openfox:split:layout', 'garbage')
    expect(readSplitLayoutMode()).toBe('columns')
  })
})
