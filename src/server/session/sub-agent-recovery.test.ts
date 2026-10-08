import { describe, it, expect } from 'vitest'
import type { StoredEvent } from '../events/types.js'
import { findInterruptedSubAgentsFromEvents, CONTINUATION_REGEX } from './sub-agent-recovery.js'

function stored(seq: number, type: string, data: unknown, timestamp = Date.now()): StoredEvent {
  return { seq, timestamp, sessionId: 's-1', type, data } as unknown as StoredEvent
}

describe('sub-agent-recovery', () => {
  describe('CONTINUATION_REGEX', () => {
    it('matches English continuation keywords', () => {
      expect(CONTINUATION_REGEX.test('continue your work')).toBe(true)
      expect(CONTINUATION_REGEX.test('Please resume exploration')).toBe(true)
      expect(CONTINUATION_REGEX.test('pick up where you left off')).toBe(true)
    })

    it('matches French continuation keywords', () => {
      expect(CONTINUATION_REGEX.test('reprends le travail')).toBe(true)
      expect(CONTINUATION_REGEX.test('peux-tu reprendre ?')).toBe(true)
      expect(CONTINUATION_REGEX.test('poursuis ton analyse')).toBe(true)
    })

    it('does not match fresh prompts', () => {
      expect(CONTINUATION_REGEX.test('find all typescript files in src')).toBe(false)
      expect(CONTINUATION_REGEX.test('verify criteria 1')).toBe(false)
    })
  })

  describe('findInterruptedSubAgentsFromEvents', () => {
    it('returns empty array when there are no events', () => {
      expect(findInterruptedSubAgentsFromEvents([])).toEqual([])
    })

    it('identifies an interrupted sub-agent that never completed', () => {
      const events = [
        stored(1, 'message.start', {
          messageId: 'prompt-1',
          role: 'user',
          content: 'Find files in src',
          subAgentId: 'sa-1',
          subAgentType: 'explorer',
          messageKind: 'auto-prompt',
        }),
        stored(2, 'message.start', {
          messageId: 'asst-1',
          role: 'assistant',
          subAgentId: 'sa-1',
          subAgentType: 'explorer',
        }),
        stored(3, 'tool.call', {
          messageId: 'asst-1',
          toolCall: { id: 'tc-1', name: 'read_file' },
        }),
        stored(4, 'chat.done', {
          messageId: 'asst-1',
          agentType: 'sub-agent',
          reason: 'stopped',
        }),
      ]

      const interrupted = findInterruptedSubAgentsFromEvents(events)
      expect(interrupted).toHaveLength(1)
      expect(interrupted[0]).toMatchObject({
        subAgentId: 'sa-1',
        subAgentType: 'explorer',
        prompt: 'Find files in src',
      })
    })

    it('excludes sub-agents that completed via return_value', () => {
      const events = [
        stored(1, 'message.start', {
          messageId: 'prompt-1',
          role: 'user',
          content: 'Find files in src',
          subAgentId: 'sa-1',
          subAgentType: 'explorer',
        }),
        stored(2, 'message.start', {
          messageId: 'asst-1',
          role: 'assistant',
          subAgentId: 'sa-1',
          subAgentType: 'explorer',
        }),
        stored(3, 'tool.call', {
          messageId: 'asst-1',
          toolCall: { id: 'tc-1', name: 'return_value' },
        }),
        stored(4, 'chat.done', {
          messageId: 'asst-1',
          agentType: 'sub-agent',
          reason: 'complete',
        }),
      ]

      const interrupted = findInterruptedSubAgentsFromEvents(events)
      expect(interrupted).toHaveLength(0)
    })

    it('tracks multiple sub-agents and identifies only interrupted ones', () => {
      const events = [
        // Sub-agent 1: completed
        stored(1, 'message.start', {
          messageId: 'prompt-1',
          role: 'user',
          content: 'Task 1',
          subAgentId: 'sa-1',
          subAgentType: 'explorer',
        }),
        stored(2, 'message.start', {
          messageId: 'asst-1',
          role: 'assistant',
          subAgentId: 'sa-1',
          subAgentType: 'explorer',
        }),
        stored(3, 'tool.call', {
          messageId: 'asst-1',
          toolCall: { id: 'tc-1', name: 'return_value' },
        }),
        stored(4, 'chat.done', {
          messageId: 'asst-1',
          agentType: 'sub-agent',
          reason: 'complete',
        }),
        // Sub-agent 2: interrupted
        stored(5, 'message.start', {
          messageId: 'prompt-2',
          role: 'user',
          content: 'Task 2',
          subAgentId: 'sa-2',
          subAgentType: 'code_reviewer',
        }),
        stored(6, 'message.start', {
          messageId: 'asst-2',
          role: 'assistant',
          subAgentId: 'sa-2',
          subAgentType: 'code_reviewer',
        }),
        stored(7, 'chat.done', {
          messageId: 'asst-2',
          agentType: 'sub-agent',
          reason: 'stopped',
        }),
      ]

      const interrupted = findInterruptedSubAgentsFromEvents(events)
      expect(interrupted).toHaveLength(1)
      expect(interrupted[0]?.subAgentId).toBe('sa-2')
      expect(interrupted[0]?.subAgentType).toBe('code_reviewer')
    })

    it('does not resurrect stale sub-agents from past completed turns', () => {
      const events = [
        // Turn 1: sub-agent interrupted, but top-level turn finished complete
        stored(1, 'message.start', {
          messageId: 'u1',
          role: 'user',
          content: 'Search code',
        }),
        stored(2, 'message.start', {
          messageId: 'prompt-1',
          role: 'user',
          content: 'Search',
          subAgentId: 'old-sa',
          subAgentType: 'explorer',
        }),
        stored(3, 'chat.done', {
          messageId: 'asst-1',
          agentType: 'sub-agent',
          reason: 'stopped',
        }),
        stored(4, 'chat.done', {
          messageId: 'asst-1',
          reason: 'complete',
        }),
        // Turn 2: normal user message
        stored(5, 'message.start', {
          messageId: 'u2',
          role: 'user',
          content: 'What is the date today?',
        }),
      ]

      const interrupted = findInterruptedSubAgentsFromEvents(events)
      expect(interrupted).toHaveLength(0)
    })
  })
})
