import { describe, it, expect, vi } from 'vitest'
import { sessionMetadataTool } from './session-metadata.js'
import type { ToolContext } from './types.js'
import type { MetadataEntry } from '../../shared/types.js'

function createSessionManager(metadataEntries: Record<string, MetadataEntry[]>) {
  return {
    requireSession: vi.fn().mockReturnValue({ metadataEntries }),
    setMetadataEntries: vi.fn(),
  }
}

function context(sessionManager: unknown): ToolContext {
  return {
    sessionManager: sessionManager as ToolContext['sessionManager'],
    workdir: '/test/workdir',
    sessionId: 'test-session',
  }
}

describe('sessionMetadataTool', () => {
  it('updates a criterion using a numeric id', async () => {
    const sm = createSessionManager({
      criteria: [{ id: '0', description: 'just a test', status: 'pending' }],
    })

    const result = await sessionMetadataTool.execute(
      { action: 'update', key: 'criteria', id: 0, status: 'completed' },
      context(sm),
    )

    expect(result.success).toBe(true)
    expect(sm.setMetadataEntries).toHaveBeenCalledWith('test-session', 'criteria', [
      { id: '0', description: 'just a test', status: 'completed' },
    ])
  })

  it('updates a criterion using a string id', async () => {
    const sm = createSessionManager({
      criteria: [{ id: '0', description: 'just a test', status: 'pending' }],
    })

    const result = await sessionMetadataTool.execute(
      { action: 'update', key: 'criteria', id: '0', status: 'completed' },
      context(sm),
    )

    expect(result.success).toBe(true)
    expect(sm.setMetadataEntries).toHaveBeenCalledWith('test-session', 'criteria', [
      { id: '0', description: 'just a test', status: 'completed' },
    ])
  })

  it('errors when updating without an id', async () => {
    const sm = createSessionManager({
      criteria: [{ id: '0', description: 'just a test', status: 'pending' }],
    })

    const result = await sessionMetadataTool.execute(
      { action: 'update', key: 'criteria', status: 'completed' },
      context(sm),
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Missing required field: id')
    expect(sm.setMetadataEntries).not.toHaveBeenCalled()
  })

  it('keeps an explicit numeric id when adding an item', async () => {
    const sm = createSessionManager({
      criteria: [{ id: '1', description: 'existing', status: 'pending' }],
    })

    const result = await sessionMetadataTool.execute(
      { action: 'add', key: 'criteria', id: 0, description: 'just a test' },
      context(sm),
    )

    expect(result.success).toBe(true)
    expect(sm.setMetadataEntries).toHaveBeenCalledWith('test-session', 'criteria', [
      { id: '1', description: 'existing', status: 'pending' },
      { id: '0', description: 'just a test', status: 'pending' },
    ])
  })

  it('starts auto-generated ids at 1', async () => {
    const sm = createSessionManager({ criteria: [] })

    const result = await sessionMetadataTool.execute(
      { action: 'add', key: 'criteria', description: 'just a test' },
      context(sm),
    )

    expect(result.success).toBe(true)
    expect(sm.setMetadataEntries).toHaveBeenCalledWith('test-session', 'criteria', [
      { id: '1', description: 'just a test', status: 'pending' },
    ])
  })

  it('auto-generates sequential ids when adding without one', async () => {
    const sm = createSessionManager({
      criteria: [{ id: '1', description: 'existing', status: 'pending' }],
    })

    const result = await sessionMetadataTool.execute(
      { action: 'add', key: 'criteria', description: 'just a test' },
      context(sm),
    )

    expect(result.success).toBe(true)
    expect(sm.setMetadataEntries).toHaveBeenCalledWith('test-session', 'criteria', [
      { id: '1', description: 'existing', status: 'pending' },
      { id: '2', description: 'just a test', status: 'pending' },
    ])
  })

  it('treats an empty-string id as missing on update', async () => {
    const sm = createSessionManager({
      criteria: [{ id: '0', description: 'just a test', status: 'pending' }],
    })

    const result = await sessionMetadataTool.execute(
      { action: 'update', key: 'criteria', id: '', status: 'completed' },
      context(sm),
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Missing required field: id')
  })

  it('treats a non-string, non-number id as missing on update', async () => {
    const sm = createSessionManager({
      criteria: [{ id: '0', description: 'just a test', status: 'pending' }],
    })

    const result = await sessionMetadataTool.execute(
      { action: 'update', key: 'criteria', id: true, status: 'completed' },
      context(sm),
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Missing required field: id')
  })

  it('removes an item using a numeric id', async () => {
    const sm = createSessionManager({
      criteria: [{ id: '0', description: 'just a test', status: 'pending' }],
    })

    const result = await sessionMetadataTool.execute({ action: 'remove', key: 'criteria', id: 0 }, context(sm))

    expect(result.success).toBe(true)
    expect(sm.setMetadataEntries).toHaveBeenCalledWith('test-session', 'criteria', [])
  })

  describe('status validation against the key schema', () => {
    it('rejects an out-of-schema status on add and lists the valid statuses', async () => {
      const sm = createSessionManager({ todos: [] })

      const result = await sessionMetadataTool.execute(
        { action: 'add', key: 'todos', description: 'a task', status: 'done' },
        context(sm),
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('pending | in_progress | completed')
      expect(sm.setMetadataEntries).not.toHaveBeenCalled()
    })

    it('rejects an out-of-schema status on update and lists the valid statuses', async () => {
      const sm = createSessionManager({
        todos: [{ id: '1', description: 'a task', status: 'pending' }],
      })

      const result = await sessionMetadataTool.execute(
        { action: 'update', key: 'todos', id: '1', status: 'done' },
        context(sm),
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('pending | in_progress | completed')
      expect(sm.setMetadataEntries).not.toHaveBeenCalled()
    })

    it('accepts a valid status on add', async () => {
      const sm = createSessionManager({ todos: [] })

      const result = await sessionMetadataTool.execute(
        { action: 'add', key: 'todos', description: 'a task', status: 'in_progress' },
        context(sm),
      )

      expect(result.success).toBe(true)
      expect(sm.setMetadataEntries).toHaveBeenCalledWith('test-session', 'todos', [
        { id: '1', description: 'a task', status: 'in_progress' },
      ])
    })

    it('defaults the add status to the key first valid status for known keys', async () => {
      const sm = createSessionManager({ review_findings: [] })

      const result = await sessionMetadataTool.execute(
        { action: 'add', key: 'review_findings', description: 'a finding' },
        context(sm),
      )

      expect(result.success).toBe(true)
      expect(sm.setMetadataEntries).toHaveBeenCalledWith('test-session', 'review_findings', [
        { id: '1', description: 'a finding', status: 'open' },
      ])
    })

    it('keeps a free status for a key without a defined schema', async () => {
      const sm = createSessionManager({ notes: [] })

      const result = await sessionMetadataTool.execute(
        { action: 'add', key: 'notes', description: 'a note', status: 'archived' },
        context(sm),
      )

      expect(result.success).toBe(true)
      expect(sm.setMetadataEntries).toHaveBeenCalledWith('test-session', 'notes', [
        { id: '1', description: 'a note', status: 'archived' },
      ])
    })

    it('still defaults to pending for a key without a defined schema', async () => {
      const sm = createSessionManager({ notes: [] })

      const result = await sessionMetadataTool.execute(
        { action: 'add', key: 'notes', description: 'a note' },
        context(sm),
      )

      expect(result.success).toBe(true)
      expect(sm.setMetadataEntries).toHaveBeenCalledWith('test-session', 'notes', [
        { id: '1', description: 'a note', status: 'pending' },
      ])
    })
  })
})
