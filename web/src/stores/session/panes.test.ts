import { describe, expect, it } from 'vitest'
import {
  emptyPane,
  paneFromFlat,
  mirror,
  effectiveFocusedId,
  isLivePane,
  updatePane,
  replacePane,
  dropPane,
} from './panes'
import type { SessionState, SessionPane } from './types'

function makeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    connectionStatus: 'disconnected',
    showPasswordModal: false,
    passwordModalRetry: false,
    sessions: [],
    searchSessions: null,
    currentSession: null,
    unreadSessionIds: [],
    messages: [],
    hiddenCount: 0,
    currentTodos: [],
    contextState: null,
    subAgentContextStates: {},
    pendingPathConfirmations: [],
    crossSessionConfirmations: {},
    sessionsWithPendingConfirmations: [],
    pendingQuestions: [],
    visionFallbackByMessage: {},
    gitStatus: null,
    queuedMessages: [],
    abortInProgress: false,
    restoredInput: null,
    error: null,
    activeWorkflowExecution: null,
    sessionsHasMore: true,
    sessionsPaginationLoading: false,
    pendingSessionCreate: false,
    pendingUpdate: null,
    panes: {},
    openSessionIds: [],
    focusedSessionId: null,
    ...overrides,
  } as SessionState
}

const session = (id: string, mode: string = 'builder') =>
  ({
    id,
    projectId: 'project-1',
    mode,
    phase: 'plan',
    isRunning: false,
    criteria: [],
  }) as unknown as SessionState['currentSession']

describe('pane helpers', () => {
  it('emptyPane provides default per-session state', () => {
    const pane = emptyPane()
    expect(pane.messages).toEqual([])
    expect(pane.session).toBeNull()
    expect(pane.error).toBeNull()
    expect(pane.currentTodos).toEqual([])
  })

  it('paneFromFlat snapshots the flat focused fields', () => {
    const state = makeState({
      currentSession: session('s1'),
      messages: [{ id: 'm1' }] as never,
      currentTodos: [{ content: 't', status: 'pending' }] as never,
    })
    const pane = paneFromFlat(state)
    expect(pane.session?.id).toBe('s1')
    expect(pane.messages).toHaveLength(1)
    expect(pane.currentTodos).toHaveLength(1)
  })

  it('mirror maps a pane back to the flat aliases', () => {
    const pane: SessionPane = { ...emptyPane(), session: session('s1'), messages: [{ id: 'm1' }] as never }
    const flat = mirror(pane)
    expect(flat.currentSession?.id).toBe('s1')
    expect(flat.messages).toHaveLength(1)
  })

  it('effectiveFocusedId prefers focusedSessionId over currentSession', () => {
    expect(effectiveFocusedId(makeState({ currentSession: session('s1') }))).toBe('s1')
    expect(effectiveFocusedId(makeState({ currentSession: session('s1'), focusedSessionId: 's2' }))).toBe('s2')
    expect(effectiveFocusedId(makeState())).toBeNull()
  })

  it('isLivePane is true for focused and open panes only', () => {
    const state = makeState({
      currentSession: session('s1'),
      panes: { s2: emptyPane() },
      openSessionIds: ['s2'],
    })
    expect(isLivePane(state, 's1')).toBe(true)
    expect(isLivePane(state, 's2')).toBe(true)
    expect(isLivePane(state, 's3')).toBe(false)
  })

  it('updatePane materializes a focused session from flat and mirrors back', () => {
    const state = makeState({ currentSession: session('s1'), messages: [] })
    const next = updatePane(state, 's1', (pane) => ({ ...pane, messages: [{ id: 'x' }] as never }))
    expect(next.panes['s1']?.messages).toHaveLength(1)
    // Mirrored to flat
    expect(next.messages).toHaveLength(1)
  })

  it('updatePane updates an open-but-unfocused pane without touching flat', () => {
    const state = makeState({
      currentSession: session('s1'),
      panes: { s2: emptyPane() },
      openSessionIds: ['s2'],
    })
    const next = updatePane(state, 's2', (pane) => ({ ...pane, messages: [{ id: 'y' }] as never }))
    expect(next.panes['s2']?.messages).toHaveLength(1)
    expect(next.messages).toHaveLength(0)
    expect(next.currentSession?.id).toBe('s1')
  })

  it('updatePane ignores sessions that are neither focused nor open', () => {
    const state = makeState({ currentSession: session('s1') })
    const next = updatePane(state, 's3', (pane) => ({ ...pane, messages: [{ id: 'z' }] as never }))
    expect(next.panes['s3']).toBeUndefined()
  })

  it('replacePane replaces a pane wholly and mirrors when focused', () => {
    const state = makeState({ currentSession: session('s1'), panes: { s1: emptyPane() }, openSessionIds: ['s1'] })
    const next = replacePane(state, 's1', { ...emptyPane(), session: session('s1-new') })
    expect(next.panes['s1']?.session?.id).toBe('s1-new')
    expect(next.currentSession?.id).toBe('s1-new')
  })

  it('dropPane removes a pane and refocuses the last remaining', () => {
    const state = makeState({
      panes: { s1: emptyPane(), s2: emptyPane() },
      openSessionIds: ['s1', 's2'],
      focusedSessionId: 's1',
    })
    const next = dropPane(state, 's1')
    expect(next.panes['s1']).toBeUndefined()
    expect(next.openSessionIds).toEqual(['s2'])
    expect(next.focusedSessionId).toBe('s2')
    expect(next.currentSession).toBeNull()
  })

  it('dropPane of the last pane clears focus entirely', () => {
    const state = makeState({ panes: { s1: emptyPane() }, openSessionIds: ['s1'], focusedSessionId: 's1' })
    const next = dropPane(state, 's1')
    expect(next.focusedSessionId).toBeNull()
    expect(next.openSessionIds).toEqual([])
  })
})
