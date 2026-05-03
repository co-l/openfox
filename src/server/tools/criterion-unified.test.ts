import { describe, expect, it, vi } from 'vitest'
import { criterionTool } from './criterion.js'

function createCriteria() {
  return [
    {
      id: '0',
      description: 'Tests pass',
      status: { type: 'pending' as const },
      attempts: [],
    },
    {
      id: '1',
      description: 'Docs updated',
      status: { type: 'pending' as const },
      attempts: [],
    },
  ]
}

function createContext(overrides: Record<string, unknown> = {}) {
  return {
    workdir: '/tmp/project',
    sessionId: 'session-1',
    sessionManager: {
      requireSession: vi.fn(() => ({ criteria: createCriteria() })),
      addCriterion: vi.fn((_sessionId, criterion) => {
        const criteria = createCriteria()
        const actualId = criteria.length.toString()
        return { criteria: [...criteria, { ...criterion, id: actualId }], actualId }
      }),
      updateCriterionFull: vi.fn((_sessionId, id, updates) =>
        createCriteria().map((c) => (c.id === id ? { ...c, ...updates } : c)),
      ),
      removeCriterion: vi.fn((_sessionId, id) => createCriteria().filter((c) => c.id !== id)),
      updateCriterionStatus: vi.fn(),
      addCriterionAttempt: vi.fn(),
      ...overrides,
    },
  }
}

describe('criterion tool', () => {
  describe('validation', () => {
    it('rejects invalid action', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'invalid' as any }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid action') })
    })

    it('adds criterion without requiring id', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'add', description: 'test' }, context as never)
      expect(result.success).toBe(true)
      expect(result.output).toContain('Added criterion "2"')
    })

    it('rejects add without description', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'add', id: 'test' }, context as never)
      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('Missing required field: description'),
      })
    })

    it('rejects update without id', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'update', description: 'test' }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Missing required field: id') })
    })

    it('rejects update without description', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'update', id: 'tests-pass' }, context as never)
      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('Missing required field: description'),
      })
    })

    it('rejects remove without id', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'remove' }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Missing required field: id') })
    })

    it('rejects complete without id', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'complete' }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Missing required field: id') })
    })

    it('rejects pass without id', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'pass' }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Missing required field: id') })
    })

    it('rejects fail without id', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'fail' }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Missing required field: id') })
    })

    it('rejects fail without reason', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'fail', id: 'tests-pass' }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Missing required field: reason') })
    })
  })

  describe('get action', () => {
    it('returns criteria list as json', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'get' }, context as never)
      expect(result.success).toBe(true)
      expect(result.output).toContain('"0"')
      expect(result.output).toContain('"1"')
      expect(result.output).not.toContain('attempts')
    })

    it('returns friendly message when no criteria', async () => {
      const context = createContext({ requireSession: vi.fn(() => ({ criteria: [] })) })
      const result = await criterionTool.execute({ action: 'get' }, context as never)
      expect(result).toMatchObject({ success: true, output: 'No criteria defined yet.' })
    })
  })

  describe('add action', () => {
    it('adds a criterion with auto-generated id', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'add', description: 'New check' }, context as never)
      expect(context.sessionManager.addCriterion).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ description: 'New check', attempts: [] }),
      )
      expect(result.success).toBe(true)
      expect(result.output).toContain('Added criterion "2"')
    })

    it('increments id for multiple criteria', async () => {
      const context = createContext({
        addCriterion: vi.fn(() => ({
          criteria: [
            ...createCriteria(),
            { id: '0', description: 'First', status: { type: 'pending' as const }, attempts: [] },
          ],
          actualId: '1',
        })),
      })
      const result = await criterionTool.execute({ action: 'add', description: 'Second' }, context as never)
      expect(context.sessionManager.addCriterion).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ description: 'Second', attempts: [] }),
      )
      expect(result.output).toContain('Added criterion "1"')
    })

    it('returns session manager error', async () => {
      const context = createContext({
        addCriterion: vi.fn(() => ({ error: 'duplicate' })),
      })
      const result = await criterionTool.execute({ action: 'add', description: 'Dup' }, context as never)
      expect(result).toMatchObject({ success: false, error: 'duplicate' })
    })
  })

  describe('update action', () => {
    it('updates a criterion', async () => {
      const context = createContext()
      const result = await criterionTool.execute(
        { action: 'update', id: '0', description: 'Updated desc' },
        context as never,
      )
      expect(context.sessionManager.updateCriterionFull).toHaveBeenCalledWith('session-1', '0', {
        description: 'Updated desc',
      })
      expect(result.success).toBe(true)
      expect(result.output).toContain('Updated criterion "0"')
    })

    it('returns error when criterion not found', async () => {
      const context = createContext({
        requireSession: vi.fn(() => ({ criteria: [] })),
      })
      const result = await criterionTool.execute(
        { action: 'update', id: 'missing', description: 'test' },
        context as never,
      )
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('not found') })
    })
  })

  describe('remove action', () => {
    it('removes a criterion', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'remove', id: '0' }, context as never)
      expect(context.sessionManager.removeCriterion).toHaveBeenCalledWith('session-1', '0')
      expect(result.success).toBe(true)
      expect(result.output).toContain('Removed criterion "0"')
    })

    it('returns error when criterion not found', async () => {
      const context = createContext({
        requireSession: vi.fn(() => ({ criteria: [] })),
      })
      const result = await criterionTool.execute({ action: 'remove', id: 'missing' }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('not found') })
    })
  })

  describe('complete action', () => {
    it('marks criterion as completed with optional reason', async () => {
      const context = createContext()
      const result = await criterionTool.execute(
        { action: 'complete', id: '0', reason: 'Tests passed' },
        context as never,
      )
      expect(context.sessionManager.updateCriterionStatus).toHaveBeenCalledWith(
        'session-1',
        '0',
        expect.objectContaining({ type: 'completed', reason: 'Tests passed' }),
      )
      expect(result.success).toBe(true)
      expect(result.output).toContain('marked as completed')
    })

    it('marks criterion as completed without reason', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'complete', id: '0' }, context as never)
      expect(context.sessionManager.updateCriterionStatus).toHaveBeenCalledWith(
        'session-1',
        '0',
        expect.objectContaining({ type: 'completed' }),
      )
      expect(result.success).toBe(true)
    })

    it('returns error when criterion not found', async () => {
      const context = createContext({
        requireSession: vi.fn(() => ({ criteria: [] })),
      })
      const result = await criterionTool.execute({ action: 'complete', id: 'missing' }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('not found') })
    })
  })

  describe('pass action', () => {
    it('marks criterion as passed', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'pass', id: '0', reason: 'Verified' }, context as never)
      expect(context.sessionManager.updateCriterionStatus).toHaveBeenCalledWith(
        'session-1',
        '0',
        expect.objectContaining({ type: 'passed' }),
      )
      expect(context.sessionManager.addCriterionAttempt).toHaveBeenCalledWith(
        'session-1',
        '0',
        expect.objectContaining({ status: 'passed' }),
      )
      expect(result.success).toBe(true)
      expect(result.output).toContain('PASSED')
    })

    it('marks criterion as passed without reason', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'pass', id: '0' }, context as never)
      expect(result.success).toBe(true)
    })

    it('returns error when criterion not found', async () => {
      const context = createContext({
        requireSession: vi.fn(() => ({ criteria: [] })),
      })
      const result = await criterionTool.execute({ action: 'pass', id: 'missing' }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('not found') })
    })
  })

  describe('fail action', () => {
    it('marks criterion as failed with reason', async () => {
      const context = createContext()
      const result = await criterionTool.execute(
        { action: 'fail', id: '0', reason: 'Snapshot mismatch' },
        context as never,
      )
      expect(context.sessionManager.updateCriterionStatus).toHaveBeenCalledWith(
        'session-1',
        '0',
        expect.objectContaining({ type: 'failed', reason: 'Snapshot mismatch' }),
      )
      expect(context.sessionManager.addCriterionAttempt).toHaveBeenCalledWith(
        'session-1',
        '0',
        expect.objectContaining({ status: 'failed', details: 'Snapshot mismatch' }),
      )
      expect(result.success).toBe(true)
      expect(result.output).toContain('FAILED')
    })

    it('returns error when criterion not found', async () => {
      const context = createContext({
        requireSession: vi.fn(() => ({ criteria: [] })),
      })
      const result = await criterionTool.execute({ action: 'fail', id: 'missing', reason: 'bad' }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('not found') })
    })
  })
})
