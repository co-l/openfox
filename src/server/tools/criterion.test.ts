import { describe, expect, it, vi } from 'vitest'
import { completeCriterionTool, failCriterionTool, passCriterionTool } from './criterion.js'

function createContext(overrides: Record<string, unknown> = {}) {
  return {
    workdir: '/tmp/project',
    sessionId: 'session-1',
    sessionManager: {
      requireSession: vi.fn(() => ({
        criteria: [
          {
            id: 'tests-pass',
            description: 'tests pass',
            status: { type: 'pending' },
            attempts: [],
          },
        ],
      })),
      updateCriterionStatus: vi.fn(),
      addCriterionAttempt: vi.fn(),
      ...overrides,
    },
  }
}

describe('criterion tools', () => {
  describe('complete_criterion', () => {
    it('marks a criterion as completed with an optional reason', async () => {
      const context = createContext()

      const result = await completeCriterionTool.execute({ id: 'tests-pass', reason: 'Ran vitest successfully' }, context as never)

      expect(context.sessionManager.updateCriterionStatus).toHaveBeenCalledWith(
        'session-1',
        'tests-pass',
        expect.objectContaining({ type: 'completed', reason: 'Ran vitest successfully' }),
      )
      expect(result.success).toBe(true)
      expect(result.output).toContain('marked as completed')
      expect(result.output).toContain('Ran vitest successfully')
    })

    it('returns an error when the criterion does not exist', async () => {
      const context = createContext({
        requireSession: vi.fn(() => ({ criteria: [] })),
      })

      const result = await completeCriterionTool.execute({ id: 'missing' }, context as never)

      expect(result).toMatchObject({
        success: false,
        error: 'Criterion not found: missing. Available: ',
      })
    })

    it('returns the thrown error message', async () => {
      const context = createContext({
        requireSession: vi.fn(() => {
          throw new Error('session exploded')
        }),
      })

      const result = await completeCriterionTool.execute({ id: 'tests-pass' }, context as never)

      expect(result).toMatchObject({ success: false, error: 'session exploded' })
    })
  })

  describe('pass_criterion', () => {
    it('marks a criterion as passed and records an attempt', async () => {
      const context = createContext({
        requireSession: vi.fn(() => ({
          criteria: [
            {
              id: 'tests-pass',
              description: 'tests pass',
              status: { type: 'completed' },
              attempts: [{ attemptNumber: 1, status: 'failed', timestamp: '2024-01-01T00:00:00.000Z', details: 'old failure' }],
            },
          ],
        })),
      })

      const result = await passCriterionTool.execute({ id: 'tests-pass' }, context as never)

      expect(context.sessionManager.updateCriterionStatus).toHaveBeenCalledWith(
        'session-1',
        'tests-pass',
        expect.objectContaining({ type: 'passed' }),
      )
      expect(context.sessionManager.addCriterionAttempt).toHaveBeenCalledWith(
        'session-1',
        'tests-pass',
        expect.objectContaining({ attemptNumber: 2, status: 'passed' }),
      )
      expect(result.success).toBe(true)
      expect(result.output).toContain('PASSED')
    })

    it('returns an error when the criterion does not exist', async () => {
      const context = createContext({
        requireSession: vi.fn(() => ({ criteria: [] })),
      })

      const result = await passCriterionTool.execute({ id: 'missing' }, context as never)

      expect(result).toMatchObject({ success: false, error: 'Criterion not found: missing' })
    })

    it('returns the thrown error message', async () => {
      const context = createContext({
        updateCriterionStatus: vi.fn(() => {
          throw new Error('cannot update')
        }),
      })

      const result = await passCriterionTool.execute({ id: 'tests-pass' }, context as never)

      expect(result).toMatchObject({ success: false, error: 'cannot update' })
    })
  })

  describe('fail_criterion', () => {
    it('marks a criterion as failed and records the failure reason', async () => {
      const context = createContext()

      const result = await failCriterionTool.execute({ id: 'tests-pass', reason: 'Snapshot mismatch' }, context as never)

      expect(context.sessionManager.updateCriterionStatus).toHaveBeenCalledWith(
        'session-1',
        'tests-pass',
        expect.objectContaining({ type: 'failed', reason: 'Snapshot mismatch' }),
      )
      expect(context.sessionManager.addCriterionAttempt).toHaveBeenCalledWith(
        'session-1',
        'tests-pass',
        expect.objectContaining({ attemptNumber: 1, status: 'failed', details: 'Snapshot mismatch' }),
      )
      expect(result.success).toBe(true)
      expect(result.output).toContain('FAILED')
    })

    it('returns an error when the criterion does not exist', async () => {
      const context = createContext({
        requireSession: vi.fn(() => ({ criteria: [] })),
      })

      const result = await failCriterionTool.execute({ id: 'missing', reason: 'nope' }, context as never)

      expect(result).toMatchObject({ success: false, error: 'Criterion not found: missing' })
    })

    it('returns the thrown error message', async () => {
      const context = createContext({
        addCriterionAttempt: vi.fn(() => {
          throw new Error('cannot record attempt')
        }),
      })

      const result = await failCriterionTool.execute({ id: 'tests-pass', reason: 'bad output' }, context as never)

      expect(result).toMatchObject({ success: false, error: 'cannot record attempt' })
    })
  })
})
