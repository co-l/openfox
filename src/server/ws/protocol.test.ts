import { describe, it, expect } from 'vitest'
import {
  createChatDoneMessage,
  createChatErrorMessage,
  createChatFormatRetryMessage,
  createChatMessageMessage,
  createChatMessageUpdatedMessage,
  createChatPathConfirmationMessage,
  createChatProgressMessage,
  createChatSummaryMessage,
  createChatTodoMessage,
  createChatToolOutputMessage,
  createChatToolPreparingMessage,
  createChatToolCallMessage,
  createChatToolResultMessage,
  createContextStateMessage,
  createCriteriaUpdatedMessage,
  createErrorMessage,
  createModeChangedMessage,
  createPhaseChangedMessage,
  createProjectListMessage,
  createProjectStateMessage,
  createSessionListMessage,
  createSessionRunningMessage,
  createSessionStateMessage,
  parseClientMessage,
  serializeServerMessage,
  storedEventToServerMessage,
} from './protocol.js'
import type { StoredEvent } from '../events/types.js'

describe('ws/protocol', () => {
  describe('parseClientMessage', () => {
    it('parses a valid client message', () => {
      expect(
        parseClientMessage(JSON.stringify({ id: '1', type: 'ask.answer', payload: { callId: 'c1', answer: 'yes' } })),
      ).toEqual({
        id: '1',
        type: 'ask.answer',
        payload: { callId: 'c1', answer: 'yes' },
      })
    })

    it('returns null for invalid JSON or invalid message shapes', () => {
      expect(parseClientMessage('{')).toBeNull()
      expect(parseClientMessage(JSON.stringify({ nope: true }))).toBeNull()
    })
  })

  describe('session and project messages', () => {
    const session = {
      id: 'session-1',
      projectId: 'project-1',
      workdir: '/tmp/project',
      mode: 'planner' as const,
      phase: 'plan' as const,
      isRunning: false,
      summary: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      messages: [],
      criteria: [],
      contextWindows: [],
      executionState: null,
      metadata: { totalTokensUsed: 0, totalToolCalls: 0, iterationCount: 0 },
    }

    const assistantMessage = {
      id: 'assistant-1',
      role: 'assistant' as const,
      content: 'Done',
      timestamp: '2024-01-01T00:00:00.000Z',
      tokenCount: 0,
      toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'src/index.ts' } }],
    }

    const toolMessage = {
      id: 'tool-1',
      role: 'tool' as const,
      content: 'File contents',
      timestamp: '2024-01-01T00:00:01.000Z',
      tokenCount: 0,
      toolCallId: 'call-1',
      toolResult: { success: true, output: 'File contents', durationMs: 3, truncated: false },
    }

    it('enriches session messages with tool results', () => {
      const message = createSessionStateMessage(session, [assistantMessage, toolMessage], [], 'corr-1')

      expect(message).toEqual({
        id: 'corr-1',
        type: 'session.state',
        payload: {
          session,
          messages: [
            {
              ...assistantMessage,
              toolCalls: [
                {
                  id: 'call-1',
                  name: 'read_file',
                  arguments: { path: 'src/index.ts' },
                  result: { success: true, output: 'File contents', durationMs: 3, truncated: false },
                },
              ],
            },
            toolMessage,
          ],
          pendingConfirmations: [],
        },
      })
    })

    it('builds project and session list messages', () => {
      const project = {
        id: 'project-1',
        name: 'OpenFox',
        workdir: '/tmp/project',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }

      expect(createProjectStateMessage(project, 'corr')).toEqual({
        id: 'corr',
        type: 'project.state',
        payload: { project },
      })
      expect(createProjectListMessage([project])).toEqual({ type: 'project.list', payload: { projects: [project] } })
      expect(
        createSessionListMessage(
          [
            {
              id: 'session-1',
              projectId: 'project-1',
              workdir: '/tmp/project',
              mode: 'planner',
              phase: 'plan',
              isRunning: false,
              createdAt: 'a',
              updatedAt: 'b',
              criteriaCount: 0,
              criteriaCompleted: 0,
              messageCount: 0,
            },
          ],
          'corr',
        ),
      ).toEqual({
        id: 'corr',
        type: 'session.list',
        payload: {
          sessions: [
            {
              id: 'session-1',
              projectId: 'project-1',
              workdir: '/tmp/project',
              mode: 'planner',
              phase: 'plan',
              isRunning: false,
              createdAt: 'a',
              updatedAt: 'b',
              criteriaCount: 0,
              criteriaCompleted: 0,
              messageCount: 0,
            },
          ],
        },
      })
      expect(createSessionRunningMessage(true)).toEqual({ type: 'session.running', payload: { isRunning: true } })
    })
  })

  describe('createChatToolOutputMessage', () => {
    it('creates correct message structure for stdout', () => {
      const msg = createChatToolOutputMessage('msg-1', 'call-1', 'hello world', 'stdout')

      expect(msg.type).toBe('chat.tool_output')
      expect(msg.payload).toEqual({
        messageId: 'msg-1',
        callId: 'call-1',
        output: 'hello world',
        stream: 'stdout',
      })
    })

    it('creates correct message structure for stderr', () => {
      const msg = createChatToolOutputMessage('msg-2', 'call-2', 'error occurred', 'stderr')

      expect(msg.type).toBe('chat.tool_output')
      expect(msg.payload).toEqual({
        messageId: 'msg-2',
        callId: 'call-2',
        output: 'error occurred',
        stream: 'stderr',
      })
    })

    it('handles empty output', () => {
      const msg = createChatToolOutputMessage('msg-1', 'call-1', '', 'stdout')

      expect(msg.payload.output).toBe('')
    })

    it('handles output with newlines', () => {
      const msg = createChatToolOutputMessage('msg-1', 'call-1', 'line1\nline2\nline3', 'stdout')

      expect(msg.payload.output).toBe('line1\nline2\nline3')
    })

    it('serializes correctly', () => {
      const msg = createChatToolOutputMessage('msg-1', 'call-1', 'test', 'stdout')
      const serialized = serializeServerMessage(msg)
      const parsed = JSON.parse(serialized)

      expect(parsed.type).toBe('chat.tool_output')
      expect(parsed.payload.messageId).toBe('msg-1')
      expect(parsed.payload.callId).toBe('call-1')
      expect(parsed.payload.output).toBe('test')
      expect(parsed.payload.stream).toBe('stdout')
    })
  })

  describe('createChatToolPreparingMessage', () => {
    it('creates correct message structure', () => {
      const msg = createChatToolPreparingMessage('msg-1', 0, 'read_file')

      expect(msg.type).toBe('chat.tool_preparing')
      expect(msg.payload).toEqual({
        messageId: 'msg-1',
        index: 0,
        name: 'read_file',
      })
    })

    it('handles different tool names', () => {
      const tools = ['read_file', 'write_file', 'edit_file', 'run_command', 'glob', 'grep']

      for (const tool of tools) {
        const msg = createChatToolPreparingMessage('msg-1', 0, tool)
        expect(msg.payload.name).toBe(tool)
      }
    })

    it('handles multiple tool indices', () => {
      const msg0 = createChatToolPreparingMessage('msg-1', 0, 'read_file')
      const msg1 = createChatToolPreparingMessage('msg-1', 1, 'glob')
      const msg2 = createChatToolPreparingMessage('msg-1', 2, 'grep')

      expect(msg0.payload.index).toBe(0)
      expect(msg1.payload.index).toBe(1)
      expect(msg2.payload.index).toBe(2)
    })

    it('serializes correctly', () => {
      const msg = createChatToolPreparingMessage('msg-1', 0, 'read_file')
      const serialized = serializeServerMessage(msg)
      const parsed = JSON.parse(serialized)

      expect(parsed.type).toBe('chat.tool_preparing')
      expect(parsed.payload.messageId).toBe('msg-1')
      expect(parsed.payload.index).toBe(0)
      expect(parsed.payload.name).toBe('read_file')
    })
  })

  describe('tool message ordering', () => {
    it('tool_preparing, tool_call, tool_output, and tool_result have consistent structure', () => {
      const toolPreparing = createChatToolPreparingMessage('msg-1', 0, 'run_command')
      const toolCall = createChatToolCallMessage('msg-1', 'call-1', 'run_command', { command: 'ls' })
      const toolOutput = createChatToolOutputMessage('msg-1', 'call-1', 'file.txt', 'stdout')
      const toolResult = createChatToolResultMessage('msg-1', 'call-1', 'run_command', {
        success: true,
        output: 'file.txt',
        durationMs: 50,
        truncated: false,
      })

      // All should have matching messageId
      expect(toolPreparing.payload.messageId).toBe('msg-1')
      expect(toolCall.payload.messageId).toBe('msg-1')
      expect(toolOutput.payload.messageId).toBe('msg-1')
      expect(toolResult.payload.messageId).toBe('msg-1')

      // tool_call, tool_output, tool_result should have callId
      expect(toolCall.payload.callId).toBe('call-1')
      expect(toolOutput.payload.callId).toBe('call-1')
      expect(toolResult.payload.callId).toBe('call-1')
    })
  })

  describe('other message builders', () => {
    it('creates progress, summary, todo, mode, phase, criteria, context, and settings messages', () => {
      expect(createChatTodoMessage([{ content: 'Write tests', status: 'in_progress' }])).toEqual({
        type: 'chat.todo',
        payload: { todos: [{ content: 'Write tests', status: 'in_progress' }] },
      })
      expect(createChatSummaryMessage('all good')).toEqual({ type: 'chat.summary', payload: { summary: 'all good' } })
      expect(createChatProgressMessage('starting')).toEqual({ type: 'chat.progress', payload: { message: 'starting' } })
      expect(createChatProgressMessage('summarizing', 'summary')).toEqual({
        type: 'chat.progress',
        payload: { message: 'summarizing', phase: 'summary' },
      })
      expect(createChatFormatRetryMessage(2, 10)).toEqual({
        type: 'chat.format_retry',
        payload: { attempt: 2, maxAttempts: 10 },
      })
      expect(
        createChatMessageMessage({
          id: 'm1',
          role: 'assistant',
          content: 'hello',
          timestamp: '2024-01-01',
          tokenCount: 0,
        }),
      ).toEqual({
        type: 'chat.message',
        payload: { message: { id: 'm1', role: 'assistant', content: 'hello', timestamp: '2024-01-01', tokenCount: 0 } },
      })
      expect(createChatMessageUpdatedMessage('m1', { isStreaming: false })).toEqual({
        type: 'chat.message_updated',
        payload: { messageId: 'm1', updates: { isStreaming: false } },
      })
      expect(createChatDoneMessage('m1', 'complete')).toEqual({
        type: 'chat.done',
        payload: { messageId: 'm1', reason: 'complete' },
      })
      expect(createChatDoneMessage('m2', 'complete', undefined, 'sub-agent')).toEqual({
        type: 'chat.done',
        payload: { messageId: 'm2', reason: 'complete', agentType: 'sub-agent' },
      })
      expect(createChatErrorMessage('boom', true)).toEqual({
        type: 'chat.error',
        payload: { error: 'boom', recoverable: true },
      })
      expect(
        createChatPathConfirmationMessage('call-1', 'read_file', ['/etc/passwd'], '/tmp/project', 'outside_workdir'),
      ).toEqual({
        type: 'chat.path_confirmation',
        payload: {
          callId: 'call-1',
          tool: 'read_file',
          paths: ['/etc/passwd'],
          workdir: '/tmp/project',
          reason: 'outside_workdir',
        },
      })
      expect(createModeChangedMessage('builder', true, 'criteria accepted')).toEqual({
        type: 'mode.changed',
        payload: { mode: 'builder', auto: true, reason: 'criteria accepted' },
      })
      expect(createPhaseChangedMessage('verification')).toEqual({
        type: 'phase.changed',
        payload: { phase: 'verification' },
      })
      expect(
        createCriteriaUpdatedMessage(
          [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'pending' }, attempts: [] }],
          'tests-pass',
        ),
      ).toEqual({
        type: 'criteria.updated',
        payload: {
          criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'pending' }, attempts: [] }],
          changedId: 'tests-pass',
        },
      })
      expect(
        createContextStateMessage({
          currentTokens: 100,
          maxTokens: 200000,
          dangerZone: false,
          canCompact: true,
          compactionCount: 0,
        }),
      ).toEqual({
        type: 'context.state',
        payload: {
          context: { currentTokens: 100, maxTokens: 200000, dangerZone: false, canCompact: true, compactionCount: 0 },
        },
      })
      expect(
        createContextStateMessage(
          { currentTokens: 100, maxTokens: 200000, dangerZone: false, canCompact: true, compactionCount: 0 },
          'sub-1',
        ),
      ).toEqual({
        type: 'context.state',
        payload: {
          context: { currentTokens: 100, maxTokens: 200000, dangerZone: false, canCompact: true, compactionCount: 0 },
          subAgentId: 'sub-1',
        },
      })
      expect(createErrorMessage('INVALID', 'bad payload', 'corr')).toEqual({
        id: 'corr',
        type: 'error',
        payload: { code: 'INVALID', message: 'bad payload' },
      })
    })
  })

  describe('storedEventToServerMessage', () => {
    const baseEvent = {
      seq: 1,
      sessionId: 'session-1',
      timestamp: Date.parse('2024-01-01T00:00:00.000Z'),
    }

    it('converts streamable events to websocket messages and skips internal ones', () => {
      const events: StoredEvent[] = [
        {
          ...baseEvent,
          type: 'message.start',
          data: {
            messageId: 'm1',
            role: 'assistant',
            content: 'Hello',
            subAgentId: 'sub-1',
            subAgentType: 'verifier',
            isSystemGenerated: true,
            messageKind: 'correction',
          },
        },
        { ...baseEvent, type: 'message.delta', data: { messageId: 'm1', content: ' world' } },
        { ...baseEvent, type: 'message.thinking', data: { messageId: 'm1', content: 'thinking' } },
        {
          ...baseEvent,
          type: 'message.done',
          data: {
            messageId: 'm1',
            partial: true,
            stats: {
              providerId: 'provider-1',
              providerName: 'Local vLLM',
              backend: 'vllm',
              model: 'qwen',
              mode: 'planner',
              totalTime: 1,
              toolTime: 0,
              prefillTokens: 1,
              prefillSpeed: 1,
              generationTokens: 1,
              generationSpeed: 1,
            },
            promptContext: {
              systemPrompt: 'sys',
              injectedFiles: [],
              userMessage: 'hello',
              messages: [{ role: 'user', content: 'hello', source: 'history' }],
              tools: [{ name: 'read_file', description: 'Read', parameters: {} }],
              requestOptions: { toolChoice: 'auto', disableThinking: false },
            },
          },
        },
        { ...baseEvent, type: 'tool.preparing', data: { messageId: 'm1', index: 0, name: 'read_file' } },
        {
          ...baseEvent,
          type: 'tool.call',
          data: { messageId: 'm1', toolCall: { id: 'call-1', name: 'read_file', arguments: { path: 'x' } } },
        },
        { ...baseEvent, type: 'tool.output', data: { toolCallId: 'call-1', stream: 'stdout', content: 'chunk' } },
        {
          ...baseEvent,
          type: 'tool.result',
          data: {
            messageId: 'm1',
            toolCallId: 'call-1',
            result: { success: true, output: 'done', durationMs: 1, truncated: false },
          },
        },
        { ...baseEvent, type: 'phase.changed', data: { phase: 'build' } },
        { ...baseEvent, type: 'mode.changed', data: { mode: 'builder', auto: true, reason: 'criteria complete' } },
        { ...baseEvent, type: 'running.changed', data: { isRunning: true } },
        { ...baseEvent, type: 'criteria.set', data: { criteria: [] } },
        {
          ...baseEvent,
          type: 'criterion.updated',
          data: { criterionId: 'tests-pass', status: { type: 'passed', verifiedAt: '2024-01-01' } },
        },
        {
          ...baseEvent,
          type: 'context.state',
          data: { currentTokens: 1, maxTokens: 2, dangerZone: false, canCompact: true, compactionCount: 0 },
        },
        { ...baseEvent, type: 'todo.updated', data: { todos: [{ content: 'write tests', status: 'pending' }] } },
        { ...baseEvent, type: 'chat.done', data: { messageId: 'm1', reason: 'complete' } },
        { ...baseEvent, type: 'chat.error', data: { error: 'boom', recoverable: false } },
        { ...baseEvent, type: 'format.retry', data: { attempt: 2, maxAttempts: 10 } },
        {
          ...baseEvent,
          type: 'turn.snapshot',
          data: {
            mode: 'planner',
            phase: 'plan',
            isRunning: false,
            messages: [],
            criteria: [],
            contextState: { currentTokens: 0, maxTokens: 1, dangerZone: false, canCompact: false, compactionCount: 0 },
            currentContextWindowId: 'window-1',
            todos: [],
            readFiles: [],
            snapshotSeq: 1,
            snapshotAt: 1,
          },
        },
        {
          ...baseEvent,
          type: 'context.compacted',
          data: {
            closedWindowId: 'window-1',
            beforeTokens: 10,
            afterTokens: 5,
            newWindowId: 'window-2',
            summary: 'compact',
          },
        },
        { ...baseEvent, type: 'unknown-event' as never, data: {} as never },
      ]

      const converted = events.map((event) => storedEventToServerMessage(event))

      expect(converted[0]).toEqual({
        type: 'chat.message',
        payload: {
          message: {
            id: 'm1',
            role: 'assistant',
            content: 'Hello',
            timestamp: '2024-01-01T00:00:00.000Z',
            tokenCount: 0,
            isStreaming: true,
            subAgentId: 'sub-1',
            subAgentType: 'verifier',
            isSystemGenerated: true,
            messageKind: 'correction',
          },
        },
      })
      expect(converted[1]).toEqual({ type: 'chat.delta', payload: { messageId: 'm1', content: ' world' } })
      expect(converted[2]).toEqual({ type: 'chat.thinking', payload: { messageId: 'm1', content: 'thinking' } })
      expect(converted[3]).toEqual({
        type: 'chat.message_updated',
        payload: {
          messageId: 'm1',
          updates: {
            isStreaming: false,
            partial: true,
            stats: {
              providerId: 'provider-1',
              providerName: 'Local vLLM',
              backend: 'vllm',
              model: 'qwen',
              mode: 'planner',
              totalTime: 1,
              toolTime: 0,
              prefillTokens: 1,
              prefillSpeed: 1,
              generationTokens: 1,
              generationSpeed: 1,
            },
            promptContext: {
              systemPrompt: 'sys',
              injectedFiles: [],
              userMessage: 'hello',
              messages: [{ role: 'user', content: 'hello', source: 'history' }],
              tools: [{ name: 'read_file', description: 'Read', parameters: {} }],
              requestOptions: { toolChoice: 'auto', disableThinking: false },
            },
          },
        },
      })
      expect(converted[4]).toEqual({
        type: 'chat.tool_preparing',
        payload: { messageId: 'm1', index: 0, name: 'read_file' },
      })
      expect(converted[5]).toEqual({
        type: 'chat.tool_call',
        payload: { messageId: 'm1', callId: 'call-1', tool: 'read_file', args: { path: 'x' } },
      })
      expect(converted[6]).toEqual({
        type: 'chat.tool_output',
        payload: { messageId: '', callId: 'call-1', output: 'chunk', stream: 'stdout' },
      })
      expect(converted[7]).toEqual({
        type: 'chat.tool_result',
        payload: {
          messageId: 'm1',
          callId: 'call-1',
          tool: '',
          result: { success: true, output: 'done', durationMs: 1, truncated: false },
        },
      })
      expect(converted[8]).toEqual({ type: 'phase.changed', payload: { phase: 'build' } })
      expect(converted[9]).toEqual({
        type: 'mode.changed',
        payload: { mode: 'builder', auto: true, reason: 'criteria complete' },
      })
      expect(converted[10]).toEqual({ type: 'session.running', payload: { isRunning: true } })
      expect(converted[11]).toEqual({ type: 'criteria.updated', payload: { criteria: [] } })
      expect(converted[12]).toBeNull()
      expect(converted[13]).toEqual({
        type: 'context.state',
        payload: {
          context: { currentTokens: 1, maxTokens: 2, dangerZone: false, canCompact: true, compactionCount: 0 },
        },
      })
      expect(converted[14]).toEqual({
        type: 'chat.todo',
        payload: { todos: [{ content: 'write tests', status: 'pending' }] },
      })
      expect(converted[15]).toEqual({ type: 'chat.done', payload: { messageId: 'm1', reason: 'complete' } })
      expect(converted[16]).toEqual({ type: 'chat.error', payload: { error: 'boom', recoverable: false } })
      expect(converted[17]).toEqual({ type: 'chat.format_retry', payload: { attempt: 2, maxAttempts: 10 } })
      expect(converted[18]).toBeNull()
      expect(converted[19]).toBeNull()
      expect(converted[20]).toBeNull()
    })
  })
})
