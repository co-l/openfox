import { describe, it, expect } from 'vitest'
import { decideNextAction } from './decision.js'
import type { Criterion } from '@openfox/shared'

// Helper to create a criterion with specific status
const criterion = (
  id: string,
  status: Criterion['status'],
  attempts: Criterion['attempts'] = []
): Criterion => ({
  id,
  description: `Test criterion ${id}`,
  status,
  attempts,
})

describe('decideNextAction', () => {
  describe('DONE cases', () => {
    it('returns DONE when all criteria are passed', () => {
      const criteria = [
        criterion('AC1', { type: 'passed', verifiedAt: '2024-01-01' }),
        criterion('AC2', { type: 'passed', verifiedAt: '2024-01-01' }),
      ]
      
      const result = decideNextAction(criteria)
      
      expect(result).toEqual({ type: 'DONE' })
    })

    it('returns DONE when no criteria exist', () => {
      const result = decideNextAction([])
      
      expect(result).toEqual({ type: 'DONE' })
    })
  })

  describe('RUN_VERIFIER cases', () => {
    it('returns RUN_VERIFIER when all criteria are completed', () => {
      const criteria = [
        criterion('AC1', { type: 'completed', completedAt: '2024-01-01' }),
        criterion('AC2', { type: 'completed', completedAt: '2024-01-01' }),
      ]
      
      const result = decideNextAction(criteria)
      
      expect(result.type).toBe('RUN_VERIFIER')
      if (result.type === 'RUN_VERIFIER') {
        expect(result.criteriaToVerify).toEqual(['AC1', 'AC2'])
      }
    })

    it('returns RUN_VERIFIER when mix of completed and passed', () => {
      const criteria = [
        criterion('AC1', { type: 'passed', verifiedAt: '2024-01-01' }),
        criterion('AC2', { type: 'completed', completedAt: '2024-01-01' }),
      ]
      
      const result = decideNextAction(criteria)
      
      expect(result.type).toBe('RUN_VERIFIER')
      if (result.type === 'RUN_VERIFIER') {
        expect(result.criteriaToVerify).toEqual(['AC2'])
      }
    })
  })

  describe('RUN_BUILDER cases', () => {
    it('returns RUN_BUILDER when any criteria are pending', () => {
      const criteria = [
        criterion('AC1', { type: 'pending' }),
        criterion('AC2', { type: 'completed', completedAt: '2024-01-01' }),
      ]
      
      const result = decideNextAction(criteria)
      
      expect(result.type).toBe('RUN_BUILDER')
      if (result.type === 'RUN_BUILDER') {
        expect(result.reason).toContain('2')
      }
    })

    it('returns RUN_BUILDER when any criteria are in_progress', () => {
      const criteria = [
        criterion('AC1', { type: 'in_progress' }),
        criterion('AC2', { type: 'passed', verifiedAt: '2024-01-01' }),
      ]
      
      const result = decideNextAction(criteria)
      
      expect(result.type).toBe('RUN_BUILDER')
    })

    it('returns RUN_BUILDER when any criteria are failed (under retry limit)', () => {
      const criteria = [
        criterion('AC1', { type: 'failed', failedAt: '2024-01-01', reason: 'Test failed' }, [
          { attemptNumber: 1, status: 'failed', timestamp: '2024-01-01' },
        ]),
        criterion('AC2', { type: 'passed', verifiedAt: '2024-01-01' }),
      ]
      
      const result = decideNextAction(criteria)
      
      expect(result.type).toBe('RUN_BUILDER')
    })

    it('includes count of remaining criteria in reason', () => {
      const criteria = [
        criterion('AC1', { type: 'pending' }),
        criterion('AC2', { type: 'pending' }),
        criterion('AC3', { type: 'passed', verifiedAt: '2024-01-01' }),
      ]
      
      const result = decideNextAction(criteria)
      
      expect(result.type).toBe('RUN_BUILDER')
      if (result.type === 'RUN_BUILDER') {
        expect(result.reason).toContain('2')
      }
    })
  })

  describe('BLOCKED cases', () => {
    it('returns BLOCKED when criterion hits retry limit (4 failures)', () => {
      const criteria = [
        criterion('AC1', { type: 'failed', failedAt: '2024-01-01', reason: 'Still failing' }, [
          { attemptNumber: 1, status: 'failed', timestamp: '2024-01-01' },
          { attemptNumber: 2, status: 'failed', timestamp: '2024-01-02' },
          { attemptNumber: 3, status: 'failed', timestamp: '2024-01-03' },
          { attemptNumber: 4, status: 'failed', timestamp: '2024-01-04' },
        ]),
        criterion('AC2', { type: 'passed', verifiedAt: '2024-01-01' }),
      ]
      
      const result = decideNextAction(criteria)
      
      expect(result.type).toBe('BLOCKED')
      if (result.type === 'BLOCKED') {
        expect(result.blockedCriteria).toEqual(['AC1'])
        expect(result.reason).toContain('AC1')
      }
    })

    it('returns BLOCKED with multiple blocked criteria', () => {
      const criteria = [
        criterion('AC1', { type: 'failed', failedAt: '2024-01-01', reason: 'Failing' }, [
          { attemptNumber: 1, status: 'failed', timestamp: '2024-01-01' },
          { attemptNumber: 2, status: 'failed', timestamp: '2024-01-02' },
          { attemptNumber: 3, status: 'failed', timestamp: '2024-01-03' },
          { attemptNumber: 4, status: 'failed', timestamp: '2024-01-04' },
        ]),
        criterion('AC2', { type: 'failed', failedAt: '2024-01-01', reason: 'Also failing' }, [
          { attemptNumber: 1, status: 'failed', timestamp: '2024-01-01' },
          { attemptNumber: 2, status: 'failed', timestamp: '2024-01-02' },
          { attemptNumber: 3, status: 'failed', timestamp: '2024-01-03' },
          { attemptNumber: 4, status: 'failed', timestamp: '2024-01-04' },
        ]),
      ]
      
      const result = decideNextAction(criteria)
      
      expect(result.type).toBe('BLOCKED')
      if (result.type === 'BLOCKED') {
        expect(result.blockedCriteria).toEqual(['AC1', 'AC2'])
      }
    })

    it('does not block if failures are under limit', () => {
      const criteria = [
        criterion('AC1', { type: 'failed', failedAt: '2024-01-01', reason: 'Failing' }, [
          { attemptNumber: 1, status: 'failed', timestamp: '2024-01-01' },
          { attemptNumber: 2, status: 'failed', timestamp: '2024-01-02' },
          { attemptNumber: 3, status: 'failed', timestamp: '2024-01-03' },
          // Only 3 failures, under limit of 4
        ]),
      ]
      
      const result = decideNextAction(criteria)
      
      expect(result.type).toBe('RUN_BUILDER')
    })

    it('only counts failed attempts, not passed ones', () => {
      const criteria = [
        criterion('AC1', { type: 'failed', failedAt: '2024-01-01', reason: 'Failing again' }, [
          { attemptNumber: 1, status: 'passed', timestamp: '2024-01-01' },  // This was passed before
          { attemptNumber: 2, status: 'failed', timestamp: '2024-01-02' },
          { attemptNumber: 3, status: 'failed', timestamp: '2024-01-03' },
          { attemptNumber: 4, status: 'failed', timestamp: '2024-01-04' },
          // Only 3 failures, should not block
        ]),
      ]
      
      const result = decideNextAction(criteria)
      
      expect(result.type).toBe('RUN_BUILDER')
    })
  })

  describe('priority order', () => {
    it('checks BLOCKED before other states', () => {
      // Even if there are pending criteria, blocked takes priority
      const criteria = [
        criterion('AC1', { type: 'pending' }),
        criterion('AC2', { type: 'failed', failedAt: '2024-01-01', reason: 'Blocked' }, [
          { attemptNumber: 1, status: 'failed', timestamp: '2024-01-01' },
          { attemptNumber: 2, status: 'failed', timestamp: '2024-01-02' },
          { attemptNumber: 3, status: 'failed', timestamp: '2024-01-03' },
          { attemptNumber: 4, status: 'failed', timestamp: '2024-01-04' },
        ]),
      ]
      
      const result = decideNextAction(criteria)
      
      expect(result.type).toBe('BLOCKED')
    })
  })
})
