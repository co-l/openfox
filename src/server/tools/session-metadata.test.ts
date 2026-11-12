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

  it('persists a reason when updating a criterion', async () => {
    const sm = createSessionManager({
      criteria: [{ id: '1', description: 'just a test', status: 'completed' }],
    })

    const result = await sessionMetadataTool.execute(
      { action: 'update', key: 'criteria', id: '1', status: 'failed', reason: 'tests do not cover the error path' },
      context(sm),
    )

    expect(result.success).toBe(true)
    expect(sm.setMetadataEntries).toHaveBeenCalledWith('test-session', 'criteria', [
      { id: '1', description: 'just a test', status: 'failed', reason: 'tests do not cover the error path' },
    ])
  })

  it('declares reason in the tool schema', () => {
    const properties = sessionMetadataTool.definition.function.parameters['properties'] as Record<string, unknown>
    expect(properties['reason']).toBeDefined()
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
})
