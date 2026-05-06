import { describe, expect, it, beforeEach } from 'vitest'
import type { StoredEvent } from '../events/types.js'
import { type TopLevelScope, type SubAgentScope, buildContextMessages } from './conversation-history.js'
import { buildContextMessagesFromEventHistory } from '../events/folding.js'

const baseEvent = {
  seq: 1,
  sessionId: 'session-1',
  timestamp: Date.parse('2024-01-01T00:00:00.000Z'),
}

function makeEvent(
  overrides: Partial<StoredEvent> & { type: StoredEvent['type']; data: StoredEvent['data'] },
): StoredEvent {
  return { ...baseEvent, ...overrides } as StoredEvent
}

let seq = 1
function nextSeq(): number {
  return seq++
}

function resetSeq(): void {
  seq = 1
}

describe('buildContextMessages', () => {
  beforeEach(() => {
    resetSeq()
  })

  describe('toplevel scope', () => {
    const topLevelScope: TopLevelScope = { type: 'toplevel', sessionId: 'session-1' }

    it('includes messages in the current context window', () => {
      const events: StoredEvent[] = [
        makeEvent({
          seq: nextSeq(),
          type: 'session.initialized',
          data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
        }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: { messageId: 'm1', role: 'user', content: 'Hello', contextWindowId: 'window-1' },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm1' } }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: { messageId: 'm2', role: 'assistant', contextWindowId: 'window-1' },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm2' } }),
      ]

      const result = buildContextMessages(events, topLevelScope)
      expect(result).toHaveLength(2)
      expect(result[0]!.role).toBe('user')
      expect(result[0]!.content).toBe('Hello')
      expect(result[1]!.role).toBe('assistant')
    })

    it('shows only messages in the new context window after compaction', () => {
      const events: StoredEvent[] = [
        makeEvent({
          seq: nextSeq(),
          type: 'session.initialized',
          data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
        }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: { messageId: 'm1', role: 'user', content: 'Old message', contextWindowId: 'window-1' },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm1' } }),
        // Compaction summary message is emitted in the old window before compaction
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: {
            messageId: 'm-summary',
            role: 'assistant',
            content: 'Summary of old conversation',
            contextWindowId: 'window-1',
            isCompactionSummary: true,
          },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm-summary' } }),
        makeEvent({
          seq: nextSeq(),
          type: 'context.compacted',
          data: {
            closedWindowId: 'window-1',
            newWindowId: 'window-2',
            beforeTokens: 100,
            afterTokens: 0,
            summary: 'Summary of old conversation',
          },
        }),
        // New message in the new window
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: { messageId: 'm2', role: 'user', content: 'New message', contextWindowId: 'window-2' },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm2' } }),
      ]

      const result = buildContextMessages(events, topLevelScope)
      // Only the new window messages are included (window-2)
      // Old window messages (including summary) are excluded by window filtering
      expect(result).toHaveLength(1)
      expect(result[0]!.content).toBe('New message')
    })

    it('excludes sub-agent messages from top-level scope', () => {
      const events: StoredEvent[] = [
        makeEvent({
          seq: nextSeq(),
          type: 'session.initialized',
          data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
        }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: { messageId: 'm1', role: 'user', content: 'User message', contextWindowId: 'window-1' },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm1' } }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: {
            messageId: 'm2',
            role: 'user',
            content: 'Verifier prompt',
            contextWindowId: 'window-1',
            subAgentId: 'sub-1',
            subAgentType: 'verifier',
            isSystemGenerated: true,
          },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm2' } }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: {
            messageId: 'm3',
            role: 'assistant',
            contextWindowId: 'window-1',
            subAgentId: 'sub-1',
            subAgentType: 'verifier',
          },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm3' } }),
      ]

      const result = buildContextMessages(events, topLevelScope)
      expect(result).toHaveLength(1)
      expect(result[0]!.content).toBe('User message')
    })

    it('excludes verifier messages when includeVerifier is false', () => {
      const scope: TopLevelScope = { type: 'toplevel', sessionId: 'session-1', includeVerifier: false }
      const events: StoredEvent[] = [
        makeEvent({
          seq: nextSeq(),
          type: 'session.initialized',
          data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
        }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: { messageId: 'm1', role: 'user', content: 'User message', contextWindowId: 'window-1' },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm1' } }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: {
            messageId: 'm2',
            role: 'user',
            content: 'Verifier prompt',
            contextWindowId: 'window-1',
            subAgentId: 'sub-1',
            subAgentType: 'verifier',
            isSystemGenerated: true,
          },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm2' } }),
      ]

      const result = buildContextMessages(events, scope)
      expect(result).toHaveLength(1)
      expect(result[0]!.content).toBe('User message')
    })

    it('includes tool calls and tool results', () => {
      const events: StoredEvent[] = [
        makeEvent({
          seq: nextSeq(),
          type: 'session.initialized',
          data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
        }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: { messageId: 'm1', role: 'assistant', contextWindowId: 'window-1' },
        }),
        makeEvent({
          seq: nextSeq(),
          type: 'tool.call',
          data: { messageId: 'm1', toolCall: { id: 'call-1', name: 'read_file', arguments: { path: '/foo' } } },
        }),
        makeEvent({
          seq: nextSeq(),
          type: 'tool.result',
          data: {
            messageId: 'm1',
            toolCallId: 'call-1',
            result: { success: true, output: 'file contents', durationMs: 10, truncated: false },
          },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm1' } }),
      ]

      const result = buildContextMessages(events, topLevelScope)
      expect(result).toHaveLength(2)
      expect(result[0]!.toolCalls).toBeDefined()
      expect(result[0]!.toolCalls).toHaveLength(1)
      expect(result[1]!.role).toBe('tool')
      expect(result[1]!.toolCallId).toBe('call-1')
    })

    it('produces the same output as buildContextMessagesFromEventHistory for top-level scope', () => {
      const events: StoredEvent[] = [
        makeEvent({
          seq: nextSeq(),
          type: 'session.initialized',
          data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
        }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: { messageId: 'm1', role: 'user', content: 'Hello', contextWindowId: 'window-1' },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm1' } }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: { messageId: 'm2', role: 'assistant', contextWindowId: 'window-1' },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm2' } }),
      ]

      const scope: TopLevelScope = { type: 'toplevel', sessionId: 'session-1', includeVerifier: false }
      const newResult = buildContextMessages(events, scope)
      const oldResult = buildContextMessagesFromEventHistory(events, 'window-1', { includeVerifier: false })
      expect(newResult).toEqual(oldResult)
    })
  })

  describe('subagent scope', () => {
    const subagentScope: SubAgentScope = {
      type: 'subagent',
      sessionId: 'session-1',
      subAgentId: 'sub-1',
      subAgentType: 'verifier',
    }

    it('includes only messages matching the subAgentId', () => {
      const events: StoredEvent[] = [
        makeEvent({
          seq: nextSeq(),
          type: 'session.initialized',
          data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
        }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: { messageId: 'm1', role: 'user', content: 'Top-level user message', contextWindowId: 'window-1' },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm1' } }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: { messageId: 'm2', role: 'assistant', contextWindowId: 'window-1' },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm2' } }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: {
            messageId: 'm3',
            role: 'user',
            content: 'Verifier prompt',
            contextWindowId: 'window-1',
            subAgentId: 'sub-1',
            subAgentType: 'verifier',
            isSystemGenerated: true,
          },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm3' } }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: {
            messageId: 'm4',
            role: 'assistant',
            contextWindowId: 'window-1',
            subAgentId: 'sub-1',
            subAgentType: 'verifier',
          },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm4' } }),
      ]

      const result = buildContextMessages(events, subagentScope)
      expect(result).toHaveLength(2)
      expect(result[0]!.content).toBe('Verifier prompt')
      expect(result[0]!.role).toBe('user')
      expect(result[1]!.role).toBe('assistant')
    })

    it('excludes messages from other sub-agents', () => {
      const events: StoredEvent[] = [
        makeEvent({
          seq: nextSeq(),
          type: 'session.initialized',
          data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
        }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: {
            messageId: 'm1',
            role: 'user',
            content: 'Verifier 1 prompt',
            contextWindowId: 'window-1',
            subAgentId: 'sub-1',
            subAgentType: 'verifier',
            isSystemGenerated: true,
          },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm1' } }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: {
            messageId: 'm2',
            role: 'user',
            content: 'Verifier 2 prompt',
            contextWindowId: 'window-1',
            subAgentId: 'sub-2',
            subAgentType: 'verifier',
            isSystemGenerated: true,
          },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm2' } }),
      ]

      const result = buildContextMessages(events, subagentScope)
      expect(result).toHaveLength(1)
      expect(result[0]!.content).toBe('Verifier 1 prompt')
    })

    it('excludes context-reset markers from LLM context (UI-only)', () => {
      const events: StoredEvent[] = [
        makeEvent({
          seq: nextSeq(),
          type: 'session.initialized',
          data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
        }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: {
            messageId: 'm-reset',
            role: 'user',
            content: 'Fresh Context - Verifier Sub-Agent',
            contextWindowId: 'window-1',
            isSystemGenerated: true,
            messageKind: 'context-reset',
            subAgentId: 'sub-1',
            subAgentType: 'verifier',
          },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm-reset' } }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: {
            messageId: 'm1',
            role: 'user',
            content: 'Verify criteria',
            contextWindowId: 'window-1',
            subAgentId: 'sub-1',
            subAgentType: 'verifier',
            isSystemGenerated: true,
            messageKind: 'auto-prompt',
          },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm1' } }),
      ]

      const result = buildContextMessages(events, subagentScope)
      expect(result).toHaveLength(1)
      expect(result[0]!.content).toBe('Verify criteria')
    })

    it('handles compaction in subagent scope', () => {
      const subagentScopeWithCompact: SubAgentScope = {
        type: 'subagent',
        sessionId: 'session-1',
        subAgentId: 'sub-1',
        subAgentType: 'verifier',
      }
      const events: StoredEvent[] = [
        makeEvent({
          seq: nextSeq(),
          type: 'session.initialized',
          data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
        }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: {
            messageId: 'm1',
            role: 'user',
            content: 'Verifier prompt',
            contextWindowId: 'window-1',
            subAgentId: 'sub-1',
            subAgentType: 'verifier',
            isSystemGenerated: true,
          },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm1' } }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: {
            messageId: 'm2',
            role: 'assistant',
            contextWindowId: 'window-1',
            subAgentId: 'sub-1',
            subAgentType: 'verifier',
          },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm2' } }),
        // Sub-agent compaction
        makeEvent({
          seq: nextSeq(),
          type: 'context.compacted',
          data: {
            closedWindowId: 'window-1',
            newWindowId: 'window-2',
            beforeTokens: 50000,
            afterTokens: 0,
            summary: 'Verified criteria X',
            subAgentId: 'sub-1',
            subAgentType: 'verifier',
          },
        }),
        // Compaction summary message in the closed window
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: {
            messageId: 'm-summary',
            role: 'assistant',
            content: 'Verified criteria X',
            contextWindowId: 'window-1',
            isCompactionSummary: true,
            subAgentId: 'sub-1',
            subAgentType: 'verifier',
          },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm-summary' } }),
        // New messages after compaction
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: {
            messageId: 'm3',
            role: 'user',
            content: 'Continue checking',
            contextWindowId: 'window-2',
            subAgentId: 'sub-1',
            subAgentType: 'verifier',
          },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm3' } }),
      ]

      const result = buildContextMessages(events, subagentScopeWithCompact)
      // Should include: summary message + new messages after compaction
      expect(result.length).toBeGreaterThanOrEqual(2)
      expect(result.some((m) => m.content.includes('Verified criteria X'))).toBe(true)
      expect(result.some((m) => m.content === 'Continue checking')).toBe(true)
    })

    it('does not include top-level compaction as sub-agent compaction', () => {
      const events: StoredEvent[] = [
        makeEvent({
          seq: nextSeq(),
          type: 'session.initialized',
          data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
        }),
        // Top-level compaction (no subAgentId)
        makeEvent({
          seq: nextSeq(),
          type: 'context.compacted',
          data: {
            closedWindowId: 'window-1',
            newWindowId: 'window-2',
            beforeTokens: 50000,
            afterTokens: 0,
            summary: 'Top-level summary',
          },
        }),
        // Sub-agent messages after top-level compaction
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: {
            messageId: 'm1',
            role: 'user',
            content: 'Sub-agent prompt',
            contextWindowId: 'window-2',
            subAgentId: 'sub-1',
            subAgentType: 'verifier',
            isSystemGenerated: true,
          },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm1' } }),
      ]

      const result = buildContextMessages(events, subagentScope)
      expect(result).toHaveLength(1)
      expect(result[0]!.content).toBe('Sub-agent prompt')
    })
  })

  describe('mixed messages', () => {
    it('toplevel scope does not include sub-agent messages, subagent scope does not include top-level messages', () => {
      const events: StoredEvent[] = [
        makeEvent({
          seq: nextSeq(),
          type: 'session.initialized',
          data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
        }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: { messageId: 'm1', role: 'user', content: 'Top-level user', contextWindowId: 'window-1' },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm1' } }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: { messageId: 'm1-assist', role: 'assistant', contextWindowId: 'window-1' },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm1-assist' } }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: {
            messageId: 'm2',
            role: 'user',
            content: 'Sub-agent prompt',
            contextWindowId: 'window-1',
            subAgentId: 'sub-1',
            subAgentType: 'verifier',
            isSystemGenerated: true,
          },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm2' } }),
        makeEvent({
          seq: nextSeq(),
          type: 'message.start',
          data: {
            messageId: 'm2-assist',
            role: 'assistant',
            contextWindowId: 'window-1',
            subAgentId: 'sub-1',
            subAgentType: 'verifier',
          },
        }),
        makeEvent({ seq: nextSeq(), type: 'message.done', data: { messageId: 'm2-assist' } }),
      ]

      const topLevelResult = buildContextMessages(events, { type: 'toplevel', sessionId: 'session-1' })
      expect(topLevelResult).toHaveLength(2)
      expect(topLevelResult[0]!.content).toBe('Top-level user')

      const subAgentResult = buildContextMessages(events, {
        type: 'subagent',
        sessionId: 'session-1',
        subAgentId: 'sub-1',
        subAgentType: 'verifier',
      })
      expect(subAgentResult).toHaveLength(2)
      expect(subAgentResult[0]!.content).toBe('Sub-agent prompt')
    })
  })
})
