import { describe, it, expect } from 'vitest'
import { buildContextMessagesFromEventHistory } from './folding.js'
import type { ToolCallWithResult, StoredEvent, TurnEvent, SessionSnapshot } from './types.js'

describe('cache preservation bug - tool result output in snapshots', () => {
  it('should preserve full tool result output (including stdout) when reconstructing from snapshots', () => {
    // This test reproduces the cache-preservation bug where tool results
    // lose their output field when reconstructed from snapshots.
    //
    // The bug: When a tool fails (success=false), the output field contains
    // valuable stdout/stderr that should be preserved.
    // But when reconstructing messages from snapshots, only the error field
    // is used, losing the output and breaking LLM cache.

    const toolCallId = 'call-1'
    const messageId = 'msg-1'

    // Simulate a failing command with both output and error
    const toolResult = {
      success: false,
      output: 'line 1\nline 2\nline 3\n[stderr] error details\n\n[Exit code: 1]',
      error: 'Command exited with code 1',
      durationMs: 100,
      truncated: false,
    }

    const toolCall: ToolCallWithResult = {
      id: toolCallId,
      name: 'run_command',
      arguments: { command: 'failing-command' },
      result: toolResult,
    }

    // Create a snapshot message with tool calls
    const snapshotMessage = {
      id: messageId,
      role: 'assistant' as const,
      content: 'Let me run this command',
      timestamp: Date.now(),
      isStreaming: false,
      toolCalls: [toolCall],
    }

    // Create snapshot event
    const snapshotEvent: StoredEvent<TurnEvent> = {
      type: 'turn.snapshot',
      sessionId: 'test-session',
      seq: 1,
      timestamp: Date.now(),
      data: {
        messages: [snapshotMessage],
        mode: 'builder' as const,
        phase: 'plan' as const,
        isRunning: false,
        criteria: [],
        metadataEntries: {},
        todos: [],
        contextState: {
          promptTokens: 0,
          compactionCount: 0,
          currentTokens: 0,
          maxTokens: 200000,
          dangerZone: false,
          canCompact: false,
          dynamicContextChanged: false,
        },
        currentContextWindowId: 'window-1',
        readFiles: [],
        snapshotSeq: 1,
        snapshotAt: Date.now(),
      } as SessionSnapshot,
    }

    const events: StoredEvent<TurnEvent>[] = [snapshotEvent]

    // Reconstruct messages from snapshot (this is what happens on subsequent calls)
    const reconstructedMessages = buildContextMessagesFromEventHistory(events)
    const reconstructedToolMessage = reconstructedMessages.find((m) => m.role === 'tool')

    expect(reconstructedToolMessage).toBeDefined()

    // THIS IS THE BUG: The reconstructed message should contain the FULL output,
    // not just the error message!
    const expectedContent = `${toolResult.output}\n\nError: ${toolResult.error}`
    expect(reconstructedToolMessage!.content).toBe(expectedContent)

    // Verify the content includes both output and error
    expect(reconstructedToolMessage!.content).toContain('line 1')
    expect(reconstructedToolMessage!.content).toContain('line 2')
    expect(reconstructedToolMessage!.content).toContain('line 3')
    expect(reconstructedToolMessage!.content).toContain('[stderr]')
    expect(reconstructedToolMessage!.content).toContain('[Exit code: 1]')
    expect(reconstructedToolMessage!.content).toContain('Command exited with code 1')
  })

  it('is byte-stable across repeated reconstructions (KV-cache prefix stability)', () => {
    // The [Duration: …] line is baked into toolResult.output at execution time
    // and persisted in the tool.result event. Every later LLM request rebuilds
    // its history from that stored output — it must never be re-rendered with a
    // fresh timestamp, or the shared prefix would change and break prefix
    // (KV) cache reuse across turns.
    const toolCallId = 'call-1'
    const messageId = 'msg-1'

    const toolResult = {
      success: true,
      output: 'build ok\n\n[Exit code: 0]\n[Duration: 4.2s]',
      durationMs: 4200,
      truncated: false,
    }

    const toolCall: ToolCallWithResult = {
      id: toolCallId,
      name: 'run_command',
      arguments: { command: 'npm run build' },
      result: toolResult,
    }

    const snapshotMessage = {
      id: messageId,
      role: 'assistant' as const,
      content: 'Running the build',
      timestamp: Date.now(),
      isStreaming: false,
      toolCalls: [toolCall],
    }

    const snapshotEvent: StoredEvent<TurnEvent> = {
      type: 'turn.snapshot',
      sessionId: 'test-session',
      seq: 1,
      timestamp: Date.now(),
      data: {
        messages: [snapshotMessage],
        mode: 'builder' as const,
        phase: 'build' as const,
        isRunning: false,
        criteria: [],
        metadataEntries: {},
        todos: [],
        contextState: {
          promptTokens: 0,
          compactionCount: 0,
          currentTokens: 0,
          maxTokens: 200000,
          dangerZone: false,
          canCompact: false,
          dynamicContextChanged: false,
        },
        currentContextWindowId: 'window-1',
        readFiles: [],
        snapshotSeq: 1,
        snapshotAt: Date.now(),
      } as SessionSnapshot,
    }

    const events: StoredEvent<TurnEvent>[] = [snapshotEvent]

    const firstTurn = buildContextMessagesFromEventHistory(events)
    const nextTurn = buildContextMessagesFromEventHistory(events)

    expect(nextTurn).toEqual(firstTurn)

    const toolMessage = firstTurn.find((m) => m.role === 'tool')
    expect(toolMessage).toBeDefined()
    expect(toolMessage!.content).toBe(toolResult.output)
    expect(toolMessage!.content).toMatch(/\[Duration: 4\.2s\]\s*$/)
  })

  it('matches the live execute-tools template for failing results without an error (no "undefined")', () => {
    // The live path (execute-tools.ts) renders `${output}\n\nError: ${error ?? ''}`.
    // The fold path must produce byte-identical content, or the KV-cache prefix
    // changes between the turn the tool ran and every later turn.
    const toolCallId = 'call-2'
    const messageId = 'msg-2'

    const toolResult = {
      success: false,
      output: 'partial work\n\n[Exit code: 130]\n[Duration: 8.4s]',
      durationMs: 8400,
      truncated: false,
    }

    const toolCall: ToolCallWithResult = {
      id: toolCallId,
      name: 'run_command',
      arguments: { command: 'sleep 60' },
      result: toolResult,
    }

    const snapshotMessage = {
      id: messageId,
      role: 'assistant' as const,
      content: 'Running a long command',
      timestamp: Date.now(),
      isStreaming: false,
      toolCalls: [toolCall],
    }

    const snapshotEvent: StoredEvent<TurnEvent> = {
      type: 'turn.snapshot',
      sessionId: 'test-session',
      seq: 1,
      timestamp: Date.now(),
      data: {
        messages: [snapshotMessage],
        mode: 'builder' as const,
        phase: 'build' as const,
        isRunning: false,
        criteria: [],
        metadataEntries: {},
        todos: [],
        contextState: {
          promptTokens: 0,
          compactionCount: 0,
          currentTokens: 0,
          maxTokens: 200000,
          dangerZone: false,
          canCompact: false,
          dynamicContextChanged: false,
        },
        currentContextWindowId: 'window-1',
        readFiles: [],
        snapshotSeq: 1,
        snapshotAt: Date.now(),
      } as SessionSnapshot,
    }

    const events: StoredEvent<TurnEvent>[] = [snapshotEvent]
    const reconstructed = buildContextMessagesFromEventHistory(events)
    const toolMessage = reconstructed.find((m) => m.role === 'tool')

    // Byte-identical to what execute-tools.ts sent live: empty error, no "undefined"
    expect(toolMessage!.content).toBe(`${toolResult.output}\n\nError: `)
    expect(toolMessage!.content).not.toContain('undefined')
  })
})
