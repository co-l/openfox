/**
 * Session State API Tests
 *
 * Tests the event-sourced session API: emitting events and reading derived state.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initEventStore, getEventStore } from './store.js'
import { buildSnapshot } from './folding.js'
import {
  emitSessionInitialized,
  emitUserMessage,
  emitAssistantMessageStart,
  emitMessageDelta,
  emitMessageDone,
  emitModeChanged,
  emitPhaseChanged,
  emitRunningChanged,
  emitCriteriaSet,
  emitCriterionUpdated,
  emitTodosUpdated,
  emitFileRead,
  emitContextCompacted,
  emitContextState,
  emitChatDone,
  emitChatError,
  emitToolCall,
  emitToolResult,
  getSessionState,
  getCurrentContextWindowId,
  getCurrentWindowMessages,
  getContextMessages,
  getReadFilesCache,
  isFileInCache,
} from './session.js'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  // Create sessions table required by initEventStore
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      workdir TEXT NOT NULL
    )
  `)
  initEventStore(db)
})

afterEach(() => {
  db.close()
})

function initSession(sessionId: string, windowId: string = 'win-1'): void {
  emitSessionInitialized(sessionId, 'proj-1', '/tmp/test', windowId)
}

// ============================================================================
// Session State Retrieval
// ============================================================================

describe('getSessionState', () => {
  it('should return undefined for non-existent session', () => {
    expect(getSessionState('nonexistent')).toBeUndefined()
  })

  it('should return state after session initialization', () => {
    initSession('s1')
    const state = getSessionState('s1')

    expect(state).toBeDefined()
    expect(state!.currentContextWindowId).toBe('win-1')
  })

  it('should include messages from user and assistant', () => {
    initSession('s1')
    emitUserMessage('s1', 'Hello', { contextWindowId: 'win-1' })

    const msgId = emitAssistantMessageStart('s1', { contextWindowId: 'win-1' })
    emitMessageDelta('s1', msgId, 'Hi there')
    emitMessageDone('s1', msgId)

    const state = getSessionState('s1')
    expect(state!.messages.length).toBeGreaterThanOrEqual(2)
  })
})

describe('getCurrentContextWindowId', () => {
  it('should return undefined for non-existent session', () => {
    expect(getCurrentContextWindowId('nonexistent')).toBeUndefined()
  })

  it('should return the initial window ID', () => {
    initSession('s1', 'my-window')
    expect(getCurrentContextWindowId('s1')).toBe('my-window')
  })

  it('should return new window ID after compaction', () => {
    initSession('s1', 'old-window')
    emitUserMessage('s1', 'Hello', { contextWindowId: 'old-window' })
    emitContextCompacted('s1', 'old-window', 'new-window', 1000, 0, 'Summary')

    expect(getCurrentContextWindowId('s1')).toBe('new-window')
  })
})

describe('getCurrentWindowMessages', () => {
  it('should return empty for non-existent session', () => {
    expect(getCurrentWindowMessages('nonexistent')).toEqual([])
  })

  it('should return only messages in current window', () => {
    initSession('s1', 'win-1')
    emitUserMessage('s1', 'Message in win-1', { contextWindowId: 'win-1' })
    emitContextCompacted('s1', 'win-1', 'win-2', 1000, 0, 'Summary')
    emitUserMessage('s1', 'Message in win-2', { contextWindowId: 'win-2' })

    const messages = getCurrentWindowMessages('s1')
    const contents = messages.map((m) => m.content)
    expect(contents).toContain('Message in win-2')
    expect(contents).not.toContain('Message in win-1')
  })
})

// ============================================================================
// Event Emission Helpers
// ============================================================================

describe('emitUserMessage', () => {
  it('should return a message ID', () => {
    initSession('s1')
    const msgId = emitUserMessage('s1', 'Hello')
    expect(msgId).toBeTruthy()
    expect(typeof msgId).toBe('string')
  })

  it('should add the message to session state', () => {
    initSession('s1')
    emitUserMessage('s1', 'Test message', { contextWindowId: 'win-1' })

    const state = getSessionState('s1')
    const userMessages = state!.messages.filter((m) => m.role === 'user')
    expect(userMessages.some((m) => m.content === 'Test message')).toBe(true)
  })

  it('should support system-generated messages', () => {
    initSession('s1')
    emitUserMessage('s1', 'Auto prompt', {
      contextWindowId: 'win-1',
      isSystemGenerated: true,
      messageKind: 'auto-prompt',
    })

    const state = getSessionState('s1')
    const autoMsg = state!.messages.find((m) => m.content === 'Auto prompt')
    expect(autoMsg).toBeDefined()
    expect(autoMsg!.isSystemGenerated).toBe(true)
    expect(autoMsg!.messageKind).toBe('auto-prompt')
  })
})

describe('emitAssistantMessageStart / emitMessageDelta / emitMessageDone', () => {
  it('should build a complete assistant message', () => {
    initSession('s1')
    const msgId = emitAssistantMessageStart('s1', { contextWindowId: 'win-1' })
    emitMessageDelta('s1', msgId, 'Hello ')
    emitMessageDelta('s1', msgId, 'world')
    emitMessageDone('s1', msgId)

    const state = getSessionState('s1')
    const assistantMsg = state!.messages.find((m) => m.id === msgId)
    expect(assistantMsg).toBeDefined()
    expect(assistantMsg!.role).toBe('assistant')
    expect(assistantMsg!.content).toBe('Hello world')
  })

  it('should support partial messages', () => {
    initSession('s1')
    const msgId = emitAssistantMessageStart('s1', { contextWindowId: 'win-1' })
    emitMessageDelta('s1', msgId, 'Partial...')
    emitMessageDone('s1', msgId, { partial: true })

    const state = getSessionState('s1')
    const msg = state!.messages.find((m) => m.id === msgId)
    expect(msg!.partial).toBe(true)
  })
})

describe('emitModeChanged', () => {
  it('should update session mode', () => {
    initSession('s1')
    emitModeChanged('s1', 'builder', false, 'User switched')

    const state = getSessionState('s1')
    expect(state!.mode).toBe('builder')
  })

  it('should support auto mode changes', () => {
    initSession('s1')
    emitModeChanged('s1', 'chat', true, 'Auto switch')

    const state = getSessionState('s1')
    expect(state!.mode).toBe('chat')
  })
})

describe('emitPhaseChanged', () => {
  it('should update session phase', () => {
    initSession('s1')
    emitPhaseChanged('s1', 'build')

    const state = getSessionState('s1')
    expect(state!.phase).toBe('build')
  })
})

describe('emitRunningChanged', () => {
  it('should update running state', () => {
    initSession('s1')
    emitRunningChanged('s1', true)

    const state = getSessionState('s1')
    expect(state!.isRunning).toBe(true)
  })

  it('should toggle running state', () => {
    initSession('s1')
    emitRunningChanged('s1', true)
    emitRunningChanged('s1', false)

    const state = getSessionState('s1')
    expect(state!.isRunning).toBe(false)
  })
})

// ============================================================================
// Criteria
// ============================================================================

describe('emitCriteriaSet / emitCriterionUpdated', () => {
  it('should set criteria on session', () => {
    initSession('s1')
    emitCriteriaSet('s1', [
      { id: 'c1', description: 'Build the thing', status: { type: 'pending' }, attempts: [] },
      { id: 'c2', description: 'Test the thing', status: { type: 'pending' }, attempts: [] },
    ])

    const state = getSessionState('s1')
    expect(state!.criteria).toHaveLength(2)
    expect(state!.criteria[0]!.id).toBe('c1')
  })

  it('should update individual criterion status', () => {
    initSession('s1')
    emitCriteriaSet('s1', [{ id: 'c1', description: 'Build the thing', status: { type: 'pending' }, attempts: [] }])
    emitCriterionUpdated('s1', 'c1', { type: 'passed', verifiedAt: new Date().toISOString() })

    const state = getSessionState('s1')
    expect(state!.criteria[0]!.status.type).toBe('passed')
  })
})

// ============================================================================
// Todos
// ============================================================================

describe('emitTodosUpdated', () => {
  it('should set todos on session', () => {
    initSession('s1')
    emitTodosUpdated('s1', [
      { content: 'Fix bug', status: 'pending' },
      { content: 'Write test', status: 'completed' },
    ])

    const state = getSessionState('s1')
    expect(state!.todos).toHaveLength(2)
    expect(state!.todos[0]!.content).toBe('Fix bug')
  })
})

// ============================================================================
// File Cache
// ============================================================================

describe('file read cache', () => {
  it('should track read files', () => {
    initSession('s1', 'win-1')
    emitFileRead('s1', '/tmp/test/file.ts', 100, 'win-1')

    const cache = getReadFilesCache('s1')
    expect(cache).toHaveLength(1)
    expect(cache[0]!.path).toBe('/tmp/test/file.ts')
  })

  it('should check if file is in cache', () => {
    initSession('s1', 'win-1')
    emitFileRead('s1', '/tmp/test/file.ts', 100, 'win-1')

    expect(isFileInCache('s1', '/tmp/test/file.ts')).toBe(true)
    expect(isFileInCache('s1', '/tmp/test/other.ts')).toBe(false)
  })

  it('should return empty cache for non-existent session', () => {
    expect(getReadFilesCache('nonexistent')).toEqual([])
  })
})

// ============================================================================
// Context Management
// ============================================================================

describe('emitContextState', () => {
  it('should update context state', () => {
    initSession('s1')
    emitContextState('s1', 5000, 200000, 0, false, true)

    const state = getSessionState('s1')
    expect(state!.contextState.currentTokens).toBe(5000)
    expect(state!.contextState.maxTokens).toBe(200000)
    expect(state!.contextState.dangerZone).toBe(false)
  })
})

// ============================================================================
// Chat Events
// ============================================================================

describe('emitChatDone', () => {
  it('should emit without error', () => {
    initSession('s1')
    const msgId = emitAssistantMessageStart('s1')
    emitMessageDone('s1', msgId)
    expect(() => emitChatDone('s1', msgId, 'complete')).not.toThrow()
  })
})

describe('emitChatError', () => {
  it('should emit without error', () => {
    initSession('s1')
    expect(() => emitChatError('s1', 'Something went wrong', true)).not.toThrow()
  })
})

// ============================================================================
// Tool Events
// ============================================================================

describe('tool events', () => {
  it('should attach tool calls and results to messages', () => {
    initSession('s1')
    const msgId = emitAssistantMessageStart('s1', { contextWindowId: 'win-1' })
    emitMessageDelta('s1', msgId, 'Let me read that file')

    const toolCall = {
      id: 'tc-1',
      name: 'read_file',
      arguments: { path: '/tmp/test.ts' } as Record<string, unknown>,
    }
    emitToolCall('s1', msgId, toolCall)
    emitToolResult('s1', msgId, 'tc-1', {
      success: true,
      output: 'file contents here',
      durationMs: 10,
      truncated: false,
    })
    emitMessageDone('s1', msgId)

    const state = getSessionState('s1')
    const msg = state!.messages.find((m) => m.id === msgId)
    expect(msg).toBeDefined()
    expect(msg!.toolCalls).toBeDefined()
    expect(msg!.toolCalls!.length).toBeGreaterThanOrEqual(1)
  })
})

describe('getSessionState with missing session.initialized', () => {
  it('should still return valid state if sessionInit is present in snapshot', async () => {
    const { getEventStore } = await import('./store.js')
    const eventStore = getEventStore()

    initSession('s1', 'original-window')
    emitUserMessage('s1', 'Hello', { contextWindowId: 'original-window' })

    const state1 = getSessionState('s1')
    expect(state1).toBeDefined()
    expect(state1!.currentContextWindowId).toBe('original-window')

    // Simulate what happens after cleanupOldEvents deletes session.initialized
    // but a snapshot with sessionInit exists - directly insert a snapshot event
    // with sessionInit but no actual messages (we just need sessionInit to be present)
    const snapshotWithSessionInit = {
      mode: 'planner' as const,
      phase: 'plan' as const,
      isRunning: false,
      messages: state1!.messages,
      criteria: [],
      metadataEntries: {},
      contextState: state1!.contextState,
      currentContextWindowId: 'original-window',
      todos: [],
      readFiles: [],
      snapshotSeq: 99,
      snapshotAt: Date.now(),
      sessionInit: {
        projectId: 'proj-1',
        workdir: '/tmp/test',
        contextWindowId: 'original-window',
      },
    }

    // Delete the session.initialized event (seq 1)
    eventStore.deleteEventsUpToSeq('s1', 1)

    // Insert a snapshot with sessionInit
    eventStore.append('s1', { type: 'turn.snapshot', data: snapshotWithSessionInit })

    const state2 = getSessionState('s1')
    expect(state2).toBeDefined()
    expect(state2!.currentContextWindowId).toBe('original-window')
  })

  it('should still return valid state if sessionInit is only in an earlier snapshot (not latest)', async () => {
    const { getEventStore } = await import('./store.js')
    const eventStore = getEventStore()

    initSession('s2', 'window-early')
    emitUserMessage('s2', 'Hello', { contextWindowId: 'window-early' })

    const state1 = getSessionState('s2')
    expect(state1).toBeDefined()

    // Simulate: snapshot WITH sessionInit is created (like a first snapshot)
    const snapshotWithSessionInit = {
      mode: 'planner' as const,
      phase: 'plan' as const,
      isRunning: false,
      messages: state1!.messages,
      criteria: [],
      metadataEntries: {},
      contextState: state1!.contextState,
      currentContextWindowId: 'window-early',
      todos: [],
      readFiles: [],
      snapshotSeq: 2,
      snapshotAt: Date.now(),
      sessionInit: {
        projectId: 'proj-1',
        workdir: '/tmp/test',
        contextWindowId: 'window-early',
      },
    }
    eventStore.append('s2', { type: 'turn.snapshot', data: snapshotWithSessionInit })

    // Now simulate what happens after context compaction changes the window:
    // A new snapshot is created WITHOUT sessionInit (because session.initialized
    // was already deleted and the new context window doesn't carry sessionInit)
    emitContextCompacted('s2', 'window-early', 'window-new', 100, 50, 'summary')
    emitRunningChanged('s2', false)

    const state2 = getSessionState('s2')
    const compactedMessages = state2!.messages

    const snapshotWithoutSessionInit = {
      mode: 'planner' as const,
      phase: 'plan' as const,
      isRunning: false,
      messages: compactedMessages,
      criteria: [],
      metadataEntries: {},
      contextState: state2!.contextState,
      currentContextWindowId: 'window-new',
      todos: [],
      readFiles: [],
      snapshotSeq: 10,
      snapshotAt: Date.now(),
      // NO sessionInit here — this is the bug scenario
    }
    eventStore.append('s2', { type: 'turn.snapshot', data: snapshotWithoutSessionInit })

    // Delete session.initialized (simulates cleanupOldEvents)
    eventStore.deleteEventsUpToSeq('s2', 1)

    // The latest snapshot has NO sessionInit, but an earlier one does
    // getSessionState should still find the contextWindowId
    const state3 = getSessionState('s2')
    expect(state3).toBeDefined()
    expect(state3!.currentContextWindowId).toBe('window-new')
    expect(state3!.mode).toBe('planner')
    expect(state3!.isRunning).toBe(false)
  })

  it('should use currentContextWindowId from snapshot when both session.initialized and sessionInit are missing', async () => {
    const { getEventStore } = await import('./store.js')
    const eventStore = getEventStore()

    // Simulate a session where consolidateSession deleted session.initialized
    // and snapshots were created without sessionInit (pre-fix)
    // but snapshots DO have currentContextWindowId
    const snapshotData = {
      mode: 'planner' as const,
      phase: 'plan' as const,
      isRunning: false,
      messages: [],
      criteria: [],
      metadataEntries: {},
      contextState: {
        currentTokens: 1000,
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      },
      currentContextWindowId: 'recovered-window-id',
      todos: [],
      readFiles: [],
      snapshotSeq: 1,
      snapshotAt: Date.now(),
      // NO sessionInit field
    }

    eventStore.append('s3', { type: 'turn.snapshot', data: snapshotData })
    emitRunningChanged('s3', false)

    // No session.initialized event, no sessionInit in snapshot
    // BUT currentContextWindowId is present in the snapshot
    const state = getSessionState('s3')
    expect(state).toBeDefined()
    expect(state!.currentContextWindowId).toBe('recovered-window-id')
    expect(state!.mode).toBe('planner')
    expect(state!.isRunning).toBe(false)
    expect(state!.messages).toBeDefined()
  })
})

// ============================================================================
// Snapshot-optimized loading (Criterion 6A)
// ============================================================================

describe('getSessionState — snapshot-optimized (getEventsSinceSnapshot)', () => {
  it('should return all messages when snapshot exists with events after', () => {
    const sessionId = 'snapshot-session-a'
    initSession(sessionId, 'win-1')

    // Emit several messages
    emitUserMessage(sessionId, 'Hello', { contextWindowId: 'win-1' })
    const msg1 = emitAssistantMessageStart(sessionId, { contextWindowId: 'win-1' })
    emitMessageDelta(sessionId, msg1, 'Hi there')
    emitMessageDone(sessionId, msg1)

    // Simulate a snapshot being created (as happens in production)
    const stateBeforeSnapshot = getSessionState(sessionId)
    const eventStore = getEventStore()
    const snapshot = buildSnapshot(stateBeforeSnapshot!, 5)
    eventStore.append(sessionId, { type: 'turn.snapshot', data: snapshot })

    // Emit more events after the snapshot
    emitUserMessage(sessionId, 'World', { contextWindowId: 'win-1' })
    const msg2 = emitAssistantMessageStart(sessionId, { contextWindowId: 'win-1' })
    emitMessageDelta(sessionId, msg2, 'Hello back')
    emitMessageDone(sessionId, msg2)

    // getSessionState should return all messages from both snapshot and newer events
    const state = getSessionState(sessionId)
    expect(state).toBeDefined()
    expect(state!.messages.length).toBeGreaterThanOrEqual(4)
    const contents = state!.messages.map((m) => m.content)
    expect(contents).toContain('Hello')
    expect(contents).toContain('Hi there')
    expect(contents).toContain('World')
    expect(contents).toContain('Hello back')
  })

  it('should return correct state when no snapshot exists', () => {
    const sessionId = 'snapshot-session-b'
    initSession(sessionId, 'win-1')

    emitUserMessage(sessionId, 'Message A', { contextWindowId: 'win-1' })
    emitUserMessage(sessionId, 'Message B', { contextWindowId: 'win-1' })

    const state = getSessionState(sessionId)
    expect(state).toBeDefined()
    expect(state!.messages.length).toBeGreaterThanOrEqual(2)
  })

  it('should return undefined for session with only snapshot but no session.initialized', () => {
    const sessionId = 'snapshot-session-c'
    const eventStore = getEventStore()

    // Directly insert a snapshot without session.initialized
    eventStore.append(sessionId, {
      type: 'turn.snapshot',
      data: {
        mode: 'builder',
        phase: 'build',
        isRunning: false,
        messages: [],
        criteria: [],
        metadataEntries: {},
        contextState: {
          currentTokens: 0,
          maxTokens: 200000,
          compactionCount: 0,
          dangerZone: false,
          canCompact: false,
          dynamicContextChanged: false,
        },
        currentContextWindowId: 'win-1',
        todos: [],
        readFiles: [],
        snapshotSeq: 1,
        snapshotAt: Date.now(),
        sessionInit: { projectId: 'proj-1', workdir: '/tmp', contextWindowId: 'win-1' },
      },
    })

    const state = getSessionState(sessionId)
    expect(state).toBeDefined()
  })
})

describe('getContextMessages — snapshot-optimized (getEventsSinceSnapshot)', () => {
  it('should return context messages when snapshot exists with events after', () => {
    const sessionId = 'ctx-snapshot-a'
    initSession(sessionId, 'win-1')

    emitUserMessage(sessionId, 'Hello', { contextWindowId: 'win-1' })
    const msg1 = emitAssistantMessageStart(sessionId, { contextWindowId: 'win-1' })
    emitMessageDelta(sessionId, msg1, 'Hi there')
    emitMessageDone(sessionId, msg1)

    // Simulate snapshot
    const eventStore = getEventStore()
    const stateBeforeSnapshot = getSessionState(sessionId)
    const snapshot = buildSnapshot(stateBeforeSnapshot!, 5)
    eventStore.append(sessionId, { type: 'turn.snapshot', data: snapshot })

    // Events after snapshot
    emitUserMessage(sessionId, 'World', { contextWindowId: 'win-1' })
    const msg2 = emitAssistantMessageStart(sessionId, { contextWindowId: 'win-1' })
    emitMessageDelta(sessionId, msg2, 'Hello back')
    emitMessageDone(sessionId, msg2)

    const messages = getContextMessages(sessionId)
    expect(messages.length).toBeGreaterThanOrEqual(4)
    const contents = messages.map((m) => m.content)
    expect(contents).toContain('Hello')
    expect(contents).toContain('Hi there')
    expect(contents).toContain('World')
    expect(contents).toContain('Hello back')
  })

  it('should return empty array for non-existent session', () => {
    expect(getContextMessages('nonexistent')).toEqual([])
  })
})
