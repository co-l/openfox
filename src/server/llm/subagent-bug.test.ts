/**
 * Test to verify convertMessages correctly handles tool results during sub-agent calls.
 *
 * Bug: After a sub-agent call, read_file tool results were incorrectly filtered out,
 * causing agents to see empty/missing results and hallucinate content.
 *
 * Fix: Only filter out tool results whose assistant messages were actually filtered out
 * (not all assistants with empty content and toolCalls).
 */

import { describe, it, expect } from 'vitest'
import { convertMessages } from './client-pure.js'

describe('convertMessages - sub-agent tool result filtering', () => {
  it('preserves tool results when assistant has empty content but non-empty toolCalls', () => {
    // Real sub-agent scenario:
    // 1. Sub-agent calls LLM
    // 2. LLM responds with tool_call for read_file (empty content, has toolCalls)
    // 3. Tool executes and returns result
    // 4. Sub-agent calls LLM again with both messages

    const messages = [
      { role: 'user' as const, content: 'Read package.json', source: 'runtime' },
      {
        role: 'assistant' as const,
        content: '',
        toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'package.json' } }],
      },
      {
        role: 'tool' as const,
        content: '1: { "version": "0.2.4" }',
        toolCallId: 'call-1',
      },
    ]

    const result = convertMessages(messages, { modelSupportsVision: false, visionFallbackEnabled: false })

    // The assistant with toolCalls should NOT be filtered (has non-empty toolCalls)
    // The tool result should be preserved
    const toolMessages = result.filter((m) => m.role === 'tool')
    expect(toolMessages).toHaveLength(1)
    expect(toolMessages[0]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call-1',
    })
  })

  it('handles mixed case with multiple assistants', () => {
    // Real scenario: one assistant gets filtered, another doesn't

    const messages = [
      // This assistant should be filtered (empty content, empty toolCalls)
      { role: 'assistant' as const, content: '', toolCalls: [] },
      // This assistant should NOT be filtered (has toolCalls)
      { role: 'assistant' as const, content: '', toolCalls: [{ id: 'call-1', name: 'read_file', arguments: {} }] },
      // Tool result for call-1 - should be preserved
      { role: 'tool' as const, content: 'file content', toolCallId: 'call-1' },
    ]

    const result = convertMessages(messages, { modelSupportsVision: false, visionFallbackEnabled: false })

    // First assistant filtered, second preserved with its tool result
    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call-1',
    })
  })

  it('preserves tool results when assistant has whitespace-only content but non-empty toolCalls', () => {
    const messages = [
      { role: 'user' as const, content: 'read package.json and tell me version' },
      { role: 'user' as const, content: '<system-reminder>Plan Mode</system-reminder>' },
      {
        role: 'assistant' as const,
        content: '\n\n\n',
        toolCalls: [{ id: 'call_2a36c70017bd44d19f6ad54e', name: 'read_file', arguments: { path: 'package.json' } }],
      },
      {
        role: 'tool' as const,
        content: '1: { "version": "0.2.4" }',
        toolCallId: 'call_2a36c70017bd44d19f6ad54e',
      },
    ]

    const result = convertMessages(messages, { modelSupportsVision: false, visionFallbackEnabled: false })

    const toolMessages = result.filter((m) => m.role === 'tool')
    expect(toolMessages).toHaveLength(1)
    expect(toolMessages[0]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_2a36c70017bd44d19f6ad54e',
    })
  })

  it('preserves tool results when assistant has actual content and toolCalls', () => {
    // Edge case: assistant message has actual content AND tool calls

    const messages = [
      {
        role: 'assistant' as const,
        content: 'Let me read that file.',
        toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'package.json' } }],
      },
      {
        role: 'tool' as const,
        content: '1: { "version": "0.2.4" }',
        toolCallId: 'call-1',
      },
    ]

    const result = convertMessages(messages, { modelSupportsVision: false, visionFallbackEnabled: false })

    // Both should be present
    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call-1',
    })
  })
})
