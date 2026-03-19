import { describe, expect, it } from 'vitest'
import {
  InvalidPhaseTransitionError,
  LLMError,
  OpenFoxError,
  SessionNotFoundError,
  ToolExecutionError,
  ValidationError,
  isRetryableError,
} from './errors.js'

describe('error utilities', () => {
  it('builds typed error classes with stable metadata', () => {
    const base = new OpenFoxError('base', 'BASE', { detail: true })
    const missing = new SessionNotFoundError('session-1')
    const transition = new InvalidPhaseTransitionError('plan', 'done')
    const tool = new ToolExecutionError('edit_file', 'failed badly', { reason: 'oops' })
    const llm = new LLMError('timeout', { attempt: 2 })
    const validation = new ValidationError('bad input', { field: 'mode' })

    expect(base).toMatchObject({ name: 'OpenFoxError', code: 'BASE', details: { detail: true } })
    expect(missing).toMatchObject({ name: 'SessionNotFoundError', code: 'SESSION_NOT_FOUND', details: { sessionId: 'session-1' } })
    expect(transition.message).toBe('Invalid phase transition: plan -> done')
    expect(tool).toMatchObject({ code: 'TOOL_EXECUTION_ERROR', details: { tool: 'edit_file', reason: 'oops' } })
    expect(llm.code).toBe('LLM_ERROR')
    expect(validation.code).toBe('VALIDATION_ERROR')
  })

  it('identifies retryable and non-retryable errors', () => {
    expect(isRetryableError(new LLMError('timeout'))).toBe(true)
    expect(isRetryableError(new ToolExecutionError('read_file', 'bad'))).toBe(true)
    expect(isRetryableError(new ValidationError('nope'))).toBe(false)
    expect(isRetryableError(new Error('plain error'))).toBe(false)
  })
})
