import { describe, expect, it, vi } from 'vitest'
import { criterionTool } from './criterion.js'

function createCriteria() {
  return [
    {
      id: 'tests-pass',
      description: 'Tests pass',
      status: { type: 'pending' as const },
      attempts: [],
    },
    {
      id: 'docs-updated',
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
      addCriterion: vi.fn((_sessionId, criterion) => ({ criteria: [...createCriteria(), criterion], actualId: criterion.id })),
      updateCriterionFull: vi.fn((_sessionId, id, updates) => createCriteria().map(c => (
        c.id === id ? { ...c, ...updates } : c
      ))),
      removeCriterion: vi.fn((_sessionId, id) => createCriteria().filter(c => c.id !== id)),
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

    it('rejects add without id', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'add', description: 'test' }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Missing required field: id') })
    })

    it('rejects add without description', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'add', id: 'test' }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Missing required field: description') })
    })

    it('rejects update without id', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'update', description: 'test' }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Missing required field: id') })
    })

    it('rejects update without description', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'update', id: 'tests-pass' }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Missing required field: description') })
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
      expect(result.output).toContain('tests-pass')
      expect(result.output).toContain('docs-updated')
      expect(result.output).not.toContain('attempts')
    })

    it('returns friendly message when no criteria', async () => {
      const context = createContext({ requireSession: vi.fn(() => ({ criteria: [] })) })
      const result = await criterionTool.execute({ action: 'get' }, context as never)
      expect(result).toMatchObject({ success: true, output: 'No criteria defined yet.' })
    })
  })

  describe('add action', () => {
    it('adds a criterion and formats output', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'add', id: 'new-check', description: 'New check' }, context as never)
      expect(context.sessionManager.addCriterion).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ id: 'new-check', description: 'New check', attempts: [] }),
      )
      expect(result.success).toBe(true)
      expect(result.output).toContain('Added criterion "new-check"')
    })

    it('notes when id was adjusted', async () => {
      const context = createContext({
        addCriterion: vi.fn(() => ({ criteria: createCriteria(), actualId: 'tests-pass-2' })),
      })
      const result = await criterionTool.execute({ action: 'add', id: 'tests-pass', description: 'Duplicate' }, context as never)
      expect(result.output).toContain('requested ID "tests-pass" was in use')
    })

    it('returns session manager error', async () => {
      const context = createContext({
        addCriterion: vi.fn(() => ({ error: 'duplicate' })),
      })
      const result = await criterionTool.execute({ action: 'add', id: 'tests-pass', description: 'Dup' }, context as never)
      expect(result).toMatchObject({ success: false, error: 'duplicate' })
    })
  })

  describe('update action', () => {
    it('updates a criterion', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'update', id: 'tests-pass', description: 'Updated desc' }, context as never)
      expect(context.sessionManager.updateCriterionFull).toHaveBeenCalledWith('session-1', 'tests-pass', { description: 'Updated desc' })
      expect(result.success).toBe(true)
      expect(result.output).toContain('Updated criterion "tests-pass"')
    })

    it('returns error when criterion not found', async () => {
      const context = createContext({
        requireSession: vi.fn(() => ({ criteria: [] })),
      })
      const result = await criterionTool.execute({ action: 'update', id: 'missing', description: 'test' }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('not found') })
    })
  })

  describe('remove action', () => {
    it('removes a criterion', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'remove', id: 'tests-pass' }, context as never)
      expect(context.sessionManager.removeCriterion).toHaveBeenCalledWith('session-1', 'tests-pass')
      expect(result.success).toBe(true)
      expect(result.output).toContain('Removed criterion "tests-pass"')
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
      const result = await criterionTool.execute({ action: 'complete', id: 'tests-pass', reason: 'Tests passed' }, context as never)
      expect(context.sessionManager.updateCriterionStatus).toHaveBeenCalledWith(
        'session-1',
        'tests-pass',
        expect.objectContaining({ type: 'completed', reason: 'Tests passed' }),
      )
      expect(result.success).toBe(true)
      expect(result.output).toContain('marked as completed')
    })

    it('marks criterion as completed without reason', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'complete', id: 'tests-pass' }, context as never)
      expect(context.sessionManager.updateCriterionStatus).toHaveBeenCalledWith(
        'session-1',
        'tests-pass',
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
      const result = await criterionTool.execute({ action: 'pass', id: 'tests-pass', reason: 'Verified' }, context as never)
      expect(context.sessionManager.updateCriterionStatus).toHaveBeenCalledWith(
        'session-1',
        'tests-pass',
        expect.objectContaining({ type: 'passed' }),
      )
      expect(context.sessionManager.addCriterionAttempt).toHaveBeenCalledWith(
        'session-1',
        'tests-pass',
        expect.objectContaining({ status: 'passed' }),
      )
      expect(result.success).toBe(true)
      expect(result.output).toContain('PASSED')
    })

    it('marks criterion as passed without reason', async () => {
      const context = createContext()
      const result = await criterionTool.execute({ action: 'pass', id: 'tests-pass' }, context as never)
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
      const result = await criterionTool.execute({ action: 'fail', id: 'tests-pass', reason: 'Snapshot mismatch' }, context as never)
      expect(context.sessionManager.updateCriterionStatus).toHaveBeenCalledWith(
        'session-1',
        'tests-pass',
        expect.objectContaining({ type: 'failed', reason: 'Snapshot mismatch' }),
      )
      expect(context.sessionManager.addCriterionAttempt).toHaveBeenCalledWith(
        'session-1',
        'tests-pass',
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
