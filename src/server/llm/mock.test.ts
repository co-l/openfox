import { describe, expect, it } from 'vitest'

import { createMockLLMClient } from './mock.js'

describe('mock llm runtime reminders', () => {
  it('ignores planner runtime reminders when resolving the active user prompt', async () => {
    const client = createMockLLMClient()

    const response = await client.complete({
      messages: [
        {
          role: 'user',
          content: 'Add criterion with ID "inspect-src": "Inspect the src directory and report what exists". Use add_criterion.',
        },
        {
          role: 'user',
          content: '<system-reminder>\n# Plan Mode - System Reminder\n\nCRITICAL: Plan mode ACTIVE - you are in read-only phase.\n</system-reminder>',
        },
      ],
    })

    expect(response.toolCalls).toEqual([
      expect.objectContaining({
        name: 'criterion',
        arguments: {
          action: 'add',
          id: 'inspect-src',
          description: 'Inspect the src directory and report what exists',
        },
      }),
    ])
  })

  it('ignores planner reminders when they are merged into the user turn', async () => {
    const client = createMockLLMClient()

    const response = await client.complete({
      messages: [
        {
          role: 'user',
          content: 'Use get_criteria to show the current criteria.\n\n<system-reminder>\n# Plan Mode - System Reminder\n\nCRITICAL: Plan mode ACTIVE - you are in read-only phase.\n</system-reminder>',
        },
      ],
    })

    expect(response.toolCalls).toEqual([
      expect.objectContaining({
        name: 'criterion',
        arguments: {
          action: 'get',
        },
      }),
    ])
  })

  it('ignores runtime reminders before the builder kickoff prompt', async () => {
    const client = createMockLLMClient()

    const response = await client.complete({
      messages: [
        {
          role: 'user',
          content: 'Add criterion with ID "trivial-pass": "This is a trivial test criterion that passes immediately". Use add_criterion.',
        },
        {
          role: 'user',
          content: '<system-reminder>\n# Build Mode - System Reminder\n\nCRITICAL: Build mode ACTIVE - implementation is now allowed.\n</system-reminder>',
        },
        {
          role: 'user',
          content: 'Implement the task and make sure you fulfil the 1 criteria.',
        },
      ],
    })

    expect(response.toolCalls).toEqual([
      expect.objectContaining({
        name: 'criterion',
        arguments: {
          action: 'complete',
          id: 'trivial-pass',
          reason: 'Trivial criterion passes immediately',
        },
      }),
      expect.objectContaining({ name: 'step_done', arguments: {} }),
    ])
  })

  it('ignores merged reminders on builder turns with direct user instructions', async () => {
    const client = createMockLLMClient()

    const response = await client.complete({
      messages: [
        {
          role: 'user',
          content: 'Create the file src/utils.ts with any content, then call complete_criterion for "file-created".\n\n<system-reminder>\n# Build Mode - System Reminder\n\nCRITICAL: Build mode ACTIVE - implementation is now allowed.\n</system-reminder>',
        },
      ],
    })

    expect(response.toolCalls).toEqual([
      expect.objectContaining({ name: 'write_file' }),
      expect.objectContaining({ name: 'criterion' }),
      expect.objectContaining({ name: 'step_done' }),
    ])
  })

  it('uses the latest merged user turn rather than falling back to an older turn', async () => {
    const client = createMockLLMClient()

    const response = await client.complete({
      messages: [
        {
          role: 'user',
          content: 'Add criterion ID "get-test": "For testing get". Use criterion.\n\n<system-reminder>\n# Plan Mode - System Reminder\n</system-reminder>',
        },
        {
          role: 'assistant',
          content: 'Added the criterion.',
          toolCalls: [{ id: 'call-1', name: 'criterion', arguments: { action: 'add', id: 'get-test', description: 'For testing get' } }],
        },
        {
          role: 'tool',
          content: 'Criterion added successfully.',
          toolCallId: 'call-1',
        },
        {
          role: 'user',
          content: 'Use get_criteria to show the current criteria.\n\n<system-reminder>\n# Plan Mode - System Reminder\n</system-reminder>',
        },
      ],
    })

    expect(response.toolCalls).toEqual([
      expect.objectContaining({
        name: 'criterion',
        arguments: {
          action: 'get',
        },
      }),
    ])
  })

  it('handles inspect-src builder criteria without looping indefinitely', async () => {
    const client = createMockLLMClient()

    const response = await client.complete({
      messages: [
        {
          role: 'user',
          content: 'Add criterion with ID "inspect-src": "Inspect the src directory and report what exists". Use add_criterion.',
        },
        {
          role: 'assistant',
          content: 'Added the criterion.',
          toolCalls: [{ id: 'call-1', name: 'add_criterion', arguments: { id: 'inspect-src', description: 'Inspect the src directory and report what exists' } }],
        },
        {
          role: 'tool',
          content: 'Added criterion "inspect-src".',
          toolCallId: 'call-1',
        },
        {
          role: 'user',
          content: 'Implement the task and make sure you fulfil the 1 criteria.',
        },
      ],
    })

    expect(response.toolCalls).toEqual([
      expect.objectContaining({ name: 'read_file' }),
      expect.objectContaining({ name: 'criterion', arguments: { action: 'complete', id: 'inspect-src', reason: 'Inspected the src directory and reported what exists' } }),
      expect.objectContaining({ name: 'step_done', arguments: {} }),
    ])
  })

  it('passes inspect-src during verifier follow-up', async () => {
    const client = createMockLLMClient()

    const response = await client.complete({
      messages: [
        {
          role: 'user',
          content: 'Add criterion with ID "inspect-src": "Inspect the src directory and report what exists". Use add_criterion.',
        },
        {
          role: 'assistant',
          content: 'Added the criterion.',
          toolCalls: [{ id: 'call-1', name: 'add_criterion', arguments: { id: 'inspect-src', description: 'Inspect the src directory and report what exists' } }],
        },
        {
          role: 'tool',
          content: 'Added criterion "inspect-src".',
          toolCallId: 'call-1',
        },
        {
          role: 'user',
          content: 'Verify each criterion marked [NEEDS VERIFICATION].',
        },
      ],
    })

    expect(response.toolCalls).toEqual([
      expect.objectContaining({ name: 'criterion', arguments: { action: 'pass', id: 'inspect-src', reason: 'Verified the src directory was inspected successfully' } }),
      expect.objectContaining({ name: 'return_value', arguments: { summary: 'Terminalized verifier work for: inspect-src.' } }),
    ])
  })

  it('continues builder retries with criterion-aware tool calls', async () => {
    const client = createMockLLMClient()

    const response = await client.complete({
      messages: [
        {
          role: 'user',
          content: 'Add criterion ID "file-created": "A new file utils.ts exists". Use add_criterion.',
        },
        {
          role: 'assistant',
          content: 'Added the criterion.',
          toolCalls: [{ id: 'call-1', name: 'add_criterion', arguments: { id: 'file-created', description: 'A new file utils.ts exists' } }],
        },
        {
          role: 'tool',
          content: 'Added criterion "file-created".',
          toolCallId: 'call-1',
        },
        {
          role: 'user',
          content: 'Continue working on the acceptance criteria. 1 criteria remaining.',
        },
      ],
    })

    expect(response.toolCalls).toEqual([
      expect.objectContaining({ name: 'write_file', arguments: { path: 'src/utils.ts', content: 'export const created = true' } }),
      expect.objectContaining({ name: 'criterion', arguments: { action: 'complete', id: 'file-created', reason: 'Created the requested file' } }),
      expect.objectContaining({ name: 'step_done', arguments: {} }),
    ])
  })

  it('handles multiple criteria in a single verifier pass', async () => {
    const client = createMockLLMClient()

    const response = await client.complete({
      messages: [
        {
          role: 'user',
          content: 'Add criterion ID "file-created": "A new file utils.ts exists". Use add_criterion.',
        },
        {
          role: 'assistant',
          content: 'Added the criterion.',
          toolCalls: [{ id: 'call-1', name: 'add_criterion', arguments: { id: 'file-created', description: 'A new file utils.ts exists' } }],
        },
        {
          role: 'tool',
          content: 'Added criterion "file-created".',
          toolCallId: 'call-1',
        },
        {
          role: 'user',
          content: 'Add criterion ID "trivial-pass": "Trivial pass criterion". Use add_criterion.',
        },
        {
          role: 'assistant',
          content: 'Added the criterion.',
          toolCalls: [{ id: 'call-2', name: 'add_criterion', arguments: { id: 'trivial-pass', description: 'Trivial pass criterion' } }],
        },
        {
          role: 'tool',
          content: 'Added criterion "trivial-pass".',
          toolCallId: 'call-2',
        },
        {
          role: 'user',
          content: 'Verify each criterion marked [NEEDS VERIFICATION].',
        },
      ],
    })

    expect(response.toolCalls).toEqual([
      expect.objectContaining({ name: 'criterion', arguments: { action: 'pass', id: 'trivial-pass', reason: 'Verified successfully' } }),
      expect.objectContaining({ name: 'criterion', arguments: { action: 'pass', id: 'file-created', reason: 'Verified the file was created successfully' } }),
      expect.objectContaining({ name: 'return_value', arguments: { summary: 'Terminalized verifier work for: trivial-pass, file-created.' } }),
    ])
  })

  it('builder workflow includes step_done', async () => {
    const client = createMockLLMClient()

    const response = await client.complete({
      messages: [
        {
          role: 'user',
          content: 'Add criterion ID "trivial-pass": "Trivial pass criterion". Use add_criterion.',
        },
        {
          role: 'assistant',
          content: 'Added the criterion.',
          toolCalls: [{ id: 'call-1', name: 'add_criterion', arguments: { id: 'trivial-pass', description: 'Trivial pass criterion' } }],
        },
        {
          role: 'tool',
          content: 'Added criterion "trivial-pass".',
          toolCallId: 'call-1',
        },
        {
          role: 'user',
          content: 'Continue working on the acceptance criteria. Complete the trivial-pass criterion. 1 criteria remaining.',
        },
      ],
    })

    expect(response.toolCalls).toEqual([
      expect.objectContaining({ name: 'criterion', arguments: { action: 'complete', id: 'trivial-pass', reason: 'Trivial criterion passes immediately' } }),
      expect.objectContaining({ name: 'step_done', arguments: {} }),
    ])
  })

  it('returns get_criteria before completing a criterion when the prompt asks for both', async () => {
    const client = createMockLLMClient()

    const response = await client.complete({
      messages: [
        {
          role: 'user',
          content: 'First call get_criteria to see what needs to be done, then create src/test.ts and call complete_criterion for "test-file".',
        },
      ],
    })

    expect(response.toolCalls).toEqual([
      expect.objectContaining({ name: 'criterion', arguments: { action: 'get' } }),
      expect.objectContaining({ name: 'write_file', arguments: { path: 'src/test.ts', content: 'export const created = true' } }),
      expect.objectContaining({ name: 'criterion', arguments: { action: 'complete', id: 'test-file', reason: 'Created the requested file' } }),
      expect.objectContaining({ name: 'step_done', arguments: {} }),
    ])
  })

  it('returns a plain text session name for session name generation prompts', async () => {
    const client = createMockLLMClient()

    const response = await client.complete({
      messages: [{
        role: 'user',
        content: `Generate a concise, descriptive session name (max 50 characters) based on the user's message.
Return ONLY the name, nothing else.

User message: How do I set up a React project with TypeScript?`,
      }],
    })

    expect(response.toolCalls).toEqual([])
    expect(response.content).toContain('React')
  })
})
