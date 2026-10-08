/**
 * Boot auto-continuation tests (TDD)
 *
 * Covers the pure planner (which sessions to continue, with which message)
 * and the runner (event finalization + queueing through the standard path).
 */
import { describe, it, expect, vi } from 'vitest'
import type { StoredEvent } from '../events/types.js'
import {
  CONTINUE_PROMPT,
  CONTINUE_AFTER_STREAM_ERROR_PROMPT,
  planBootContinuation,
  runBootAutoContinuations,
  type BootAutoContinueDeps,
} from './auto-continue.js'

function stored(seq: number, type: string, data: unknown): StoredEvent {
  return { seq, timestamp: Date.now(), sessionId: 's-1', type, data } as unknown as StoredEvent
}

const userStart = (messageId: string, seq: number) => stored(seq, 'message.start', { messageId, role: 'user' })
const assistantStart = (messageId: string, seq: number) =>
  stored(seq, 'message.start', { messageId, role: 'assistant' })
const assistantDelta = (messageId: string, seq: number) =>
  stored(seq, 'message.delta', { messageId, content: 'partial' })
const messageDone = (messageId: string, seq: number) => stored(seq, 'message.done', { messageId })

describe('planBootContinuation', () => {
  it('returns the stream-error reminder and finalizes the partial bubble when the last assistant message is unfinalized (mid-generation)', () => {
    const plan = planBootContinuation([userStart('u1', 1), assistantStart('a1', 2), assistantDelta('a1', 3)], false)
    expect(plan).toEqual({ finalizeMessageId: 'a1', content: CONTINUE_AFTER_STREAM_ERROR_PROMPT })
  })

  it('returns a plain continue prompt without finalizing when the last assistant message was completed', () => {
    const plan = planBootContinuation(
      [userStart('u1', 1), assistantStart('a1', 2), assistantDelta('a1', 3), messageDone('a1', 4)],
      false,
    )
    expect(plan).toEqual({ content: CONTINUE_PROMPT })
  })

  it('skips sessions with an active workflow execution', () => {
    const plan = planBootContinuation([userStart('u1', 1), assistantStart('a1', 2), assistantDelta('a1', 3)], true)
    expect(plan).toBeNull()
  })

  it('returns a plain continue prompt when there is no assistant message', () => {
    const plan = planBootContinuation([userStart('u1', 1), userStart('u2', 2)], false)
    expect(plan).toEqual({ content: CONTINUE_PROMPT })
  })

  it('detects an interrupted sub-agent and includes its subAgentId in the continuation plan', () => {
    const events = [
      userStart('u1', 1),
      stored(2, 'message.start', {
        messageId: 'sa-prompt',
        role: 'user',
        content: 'Check code',
        subAgentId: 'sub-1',
        subAgentType: 'explorer',
        messageKind: 'auto-prompt',
      }),
      stored(3, 'message.start', {
        messageId: 'sa-asst',
        role: 'assistant',
        subAgentId: 'sub-1',
        subAgentType: 'explorer',
      }),
    ]
    const plan = planBootContinuation(events, false)
    expect(plan).not.toBeNull()
    expect(plan?.finalizeMessageId).toBe('sa-asst')
    expect(plan?.content).toContain('sub-1')
    expect(plan?.content).toContain('explorer')
    expect(plan?.content).toContain('call_sub_agent')
  })

  it('detects multiple interrupted sub-agents and includes all their subAgentIds', () => {
    const events = [
      userStart('u1', 1),
      stored(2, 'message.start', {
        messageId: 'sa-prompt-1',
        role: 'user',
        content: 'Explore',
        subAgentId: 'sub-1',
        subAgentType: 'explorer',
      }),
      stored(3, 'message.start', {
        messageId: 'sa-prompt-2',
        role: 'user',
        content: 'Review',
        subAgentId: 'sub-2',
        subAgentType: 'code_reviewer',
      }),
      messageDone('u1', 4),
    ]
    const plan = planBootContinuation(events, false)
    expect(plan).not.toBeNull()
    expect(plan?.content).toContain('sub-1')
    expect(plan?.content).toContain('sub-2')
    expect(plan?.content).toContain('explorer')
    expect(plan?.content).toContain('code_reviewer')
  })
})

describe('runBootAutoContinuations', () => {
  it('queues the stream-error reminder and appends a partial-done finalize event for mid-generation sessions', () => {
    const appended: Array<{ sessionId: string; event: unknown }> = []
    const queued: Array<{ sessionId: string; content: string }> = []
    const deps: BootAutoContinueDeps = {
      getEvents: () => [userStart('u1', 1), assistantStart('a1', 2), assistantDelta('a1', 3)],
      hasActiveWorkflow: () => false,
      appendEvent: (sessionId, event) => appended.push({ sessionId, event }),
      queueMessage: (sessionId, content) => queued.push({ sessionId, content }),
    }

    const count = runBootAutoContinuations(['s-1'], deps)

    expect(count).toBe(1)
    expect(appended).toHaveLength(1)
    expect(appended[0]!.sessionId).toBe('s-1')
    expect((appended[0]!.event as { type: string; data: { messageId: string; partial?: boolean } }).type).toBe(
      'message.done',
    )
    expect((appended[0]!.event as { data: { messageId: string; partial?: boolean } }).data).toMatchObject({
      messageId: 'a1',
      partial: true,
    })
    expect(queued).toEqual([{ sessionId: 's-1', content: CONTINUE_AFTER_STREAM_ERROR_PROMPT }])
  })

  it('queues a plain continue prompt and emits no finalize event for completed sessions', () => {
    const appended: unknown[] = []
    const queued: string[] = []
    const deps: BootAutoContinueDeps = {
      getEvents: () => [userStart('u1', 1), assistantStart('a1', 2), messageDone('a1', 3)],
      hasActiveWorkflow: () => false,
      appendEvent: (_sessionId, event) => appended.push(event),
      queueMessage: (_sessionId, content) => queued.push(content),
    }

    const count = runBootAutoContinuations(['s-1'], deps)

    expect(count).toBe(1)
    expect(appended).toHaveLength(0)
    expect(queued).toEqual([CONTINUE_PROMPT])
  })

  it('skips sessions with an active workflow execution', () => {
    const appended: unknown[] = []
    const queued: string[] = []
    const deps: BootAutoContinueDeps = {
      getEvents: () => [userStart('u1', 1), assistantStart('a1', 2), assistantDelta('a1', 3)],
      hasActiveWorkflow: () => true,
      appendEvent: (_sessionId, event) => appended.push(event),
      queueMessage: (sessionId) => queued.push(sessionId),
    }

    const count = runBootAutoContinuations(['s-1'], deps)

    expect(count).toBe(0)
    expect(appended).toHaveLength(0)
    expect(queued).toEqual([])
  })

  it('processes multiple sessions and reports the total count', () => {
    const deps: BootAutoContinueDeps = {
      getEvents: vi.fn((sessionId: string) =>
        sessionId === 's-1'
          ? [userStart('u1', 1), assistantStart('a1', 2), assistantDelta('a1', 3)]
          : [userStart('u1', 1), assistantStart('a1', 2), messageDone('a1', 3)],
      ),
      hasActiveWorkflow: () => false,
      appendEvent: () => {},
      queueMessage: () => {},
    }

    const count = runBootAutoContinuations(['s-1', 's-2'], deps)

    expect(count).toBe(2)
  })
})
