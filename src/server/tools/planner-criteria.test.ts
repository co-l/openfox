import { describe, expect, it, vi } from 'vitest'
import {
  addCriterionTool,
  getCriteriaTool,
  removeCriterionTool,
  updateCriterionTool,
} from './planner-criteria.js'

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
      updateCriterionFull: vi.fn((_sessionId, id, updates) => createCriteria().map(criterion => (
        criterion.id === id ? { ...criterion, ...updates } : criterion
      ))),
      removeCriterion: vi.fn((_sessionId, id) => createCriteria().filter(criterion => criterion.id !== id)),
      ...overrides,
    },
  }
}

describe('planner criteria tools', () => {
  describe('get_criteria', () => {
    it('returns a friendly message when there are no criteria', async () => {
      const context = createContext({ requireSession: vi.fn(() => ({ criteria: [] })) })

      const result = await getCriteriaTool.execute({}, context as never)

      expect(result).toMatchObject({ success: true, output: 'No criteria defined yet.' })
    })

    it('returns the criteria list as json', async () => {
      const context = createContext()

      const result = await getCriteriaTool.execute({}, context as never)

      expect(result.success).toBe(true)
      expect(result.output).toContain('tests-pass')
      expect(result.output).toContain('docs-updated')
      expect(result.output).not.toContain('attempts')
    })
  })

  describe('add_criterion', () => {
    it('validates required fields', async () => {
      const context = createContext()

      await expect(addCriterionTool.execute({}, context as never)).resolves.toMatchObject({ success: false, error: 'id is required' })
      await expect(addCriterionTool.execute({ id: 'tests-pass' }, context as never)).resolves.toMatchObject({ success: false, error: 'description is required' })
    })

    it('adds a criterion and formats the full criteria list', async () => {
      const context = createContext()

      const result = await addCriterionTool.execute({ id: 'new-check', description: 'New acceptance check' }, context as never)

      expect(context.sessionManager.addCriterion).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ id: 'new-check', description: 'New acceptance check', attempts: [] }),
      )
      expect(result.success).toBe(true)
      expect(result.output).toContain('Added criterion "new-check"')
      expect(result.output).toContain('[tests-pass] Tests pass')
      expect(result.output).toContain('[new-check] New acceptance check')
    })

    it('notes when the requested id was adjusted', async () => {
      const context = createContext({
        addCriterion: vi.fn(() => ({ criteria: createCriteria(), actualId: 'tests-pass-2' })),
      })

      const result = await addCriterionTool.execute({ id: 'tests-pass', description: 'Duplicate' }, context as never)

      expect(result.output).toContain('requested ID "tests-pass" was in use, using "tests-pass-2" instead')
    })

    it('returns a session manager error', async () => {
      const context = createContext({
        addCriterion: vi.fn(() => ({ error: 'duplicate criterion' })),
      })

      const result = await addCriterionTool.execute({ id: 'tests-pass', description: 'Duplicate' }, context as never)

      expect(result).toMatchObject({ success: false, error: 'duplicate criterion' })
    })
  })

  describe('update_criterion', () => {
    it('validates id, existence, and description', async () => {
      const context = createContext()

      await expect(updateCriterionTool.execute({}, context as never)).resolves.toMatchObject({ success: false, error: 'id is required' })
      await expect(updateCriterionTool.execute({ id: 'missing', description: 'x' }, context as never)).resolves.toMatchObject({ success: false, error: 'criterion "missing" not found' })
      await expect(updateCriterionTool.execute({ id: 'tests-pass' }, context as never)).resolves.toMatchObject({ success: false, error: 'description is required for update' })
    })

    it('updates a criterion and formats the result', async () => {
      const context = createContext()

      const result = await updateCriterionTool.execute({ id: 'tests-pass', description: 'Tests pass on CI' }, context as never)

      expect(context.sessionManager.updateCriterionFull).toHaveBeenCalledWith('session-1', 'tests-pass', { description: 'Tests pass on CI' })
      expect(result.success).toBe(true)
      expect(result.output).toContain('Updated criterion "tests-pass"')
      expect(result.output).toContain('[tests-pass] Tests pass on CI')
    })
  })

  describe('remove_criterion', () => {
    it('validates required id and existence', async () => {
      const context = createContext()

      await expect(removeCriterionTool.execute({}, context as never)).resolves.toMatchObject({ success: false, error: 'id is required' })
      await expect(removeCriterionTool.execute({ id: 'missing' }, context as never)).resolves.toMatchObject({ success: false, error: 'criterion "missing" not found' })
    })

    it('returns remaining criteria when some still exist', async () => {
      const context = createContext()

      const result = await removeCriterionTool.execute({ id: 'tests-pass' }, context as never)

      expect(context.sessionManager.removeCriterion).toHaveBeenCalledWith('session-1', 'tests-pass')
      expect(result.success).toBe(true)
      expect(result.output).toContain('Removed criterion "tests-pass"')
      expect(result.output).toContain('[docs-updated] Docs updated')
    })

    it('returns an empty-state message when the last criterion is removed', async () => {
      const context = createContext({
        requireSession: vi.fn(() => ({ criteria: [createCriteria()[0]] })),
        removeCriterion: vi.fn(() => []),
      })

      const result = await removeCriterionTool.execute({ id: 'tests-pass' }, context as never)

      expect(result).toMatchObject({ success: true, output: 'Removed criterion "tests-pass". No criteria remaining.' })
    })
  })
})
