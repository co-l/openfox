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
        todos: [],
        contextState: { 
          promptTokens: 0, 
          compactionCount: 0,
          currentTokens: 0,
          maxTokens: 200000,
          dangerZone: false,
          canCompact: false,
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
    const reconstructedToolMessage = reconstructedMessages.find(m => m.role === 'tool')
    
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
})
