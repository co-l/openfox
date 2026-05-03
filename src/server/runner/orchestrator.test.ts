/**
 * Runner Orchestrator Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OrchestratorOptions } from './types.js'

// Mock all dependencies
vi.mock('../runtime-config.js', () => ({
  getRuntimeConfig: vi.fn(() => ({
    mode: 'production',
    activeWorkflowId: undefined,
  })),
}))

vi.mock('../../cli/paths.js', () => ({
  getGlobalConfigDir: vi.fn(() => '/mock/config'),
}))

vi.mock('../workflows/registry.js', () => ({
  loadAllWorkflows: vi.fn(async () => []),
  findWorkflowById: vi.fn(),
}))

vi.mock('../workflows/executor.js', () => ({
  executeWorkflow: vi.fn(async () => ({
    finalAction: { type: 'DONE' },
    iterations: 1,
    totalTime: 100,
  })),
}))

import { runOrchestrator } from './orchestrator.js'
import { getRuntimeConfig } from '../runtime-config.js'
import { loadAllWorkflows, findWorkflowById } from '../workflows/registry.js'
import { executeWorkflow } from '../workflows/executor.js'

const mockOptions: OrchestratorOptions = {
  sessionManager: {} as any,
  sessionId: 'test-session',
  llmClient: {} as any,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runOrchestrator', () => {
  it('should throw when workflow is not found', async () => {
    vi.mocked(loadAllWorkflows).mockResolvedValue([])
    vi.mocked(findWorkflowById).mockReturnValue(undefined)

    await expect(runOrchestrator(mockOptions)).rejects.toThrow('Workflow "default" not found')
  })

  it('should use "default" workflow ID when none specified', async () => {
    vi.mocked(loadAllWorkflows).mockResolvedValue([])
    vi.mocked(findWorkflowById).mockReturnValue(undefined)

    await expect(runOrchestrator(mockOptions)).rejects.toThrow('Workflow "default" not found')
    expect(findWorkflowById).toHaveBeenCalledWith('default', [])
  })

  it('should use options.workflowId when provided', async () => {
    vi.mocked(loadAllWorkflows).mockResolvedValue([])
    vi.mocked(findWorkflowById).mockReturnValue(undefined)

    await expect(runOrchestrator({ ...mockOptions, workflowId: 'custom' })).rejects.toThrow(
      'Workflow "custom" not found',
    )
    expect(findWorkflowById).toHaveBeenCalledWith('custom', [])
  })

  it('should use runtime config activeWorkflowId as fallback', async () => {
    vi.mocked(getRuntimeConfig).mockReturnValue({
      activeWorkflowId: 'from-config',
    } as any)
    vi.mocked(loadAllWorkflows).mockResolvedValue([])
    vi.mocked(findWorkflowById).mockReturnValue(undefined)

    await expect(runOrchestrator(mockOptions)).rejects.toThrow('Workflow "from-config" not found')
    expect(findWorkflowById).toHaveBeenCalledWith('from-config', [])
  })

  it('should delegate to executeWorkflow when workflow is found', async () => {
    const mockWorkflow = {
      metadata: { id: 'default', name: 'Default', description: '', version: '1' },
      entryStep: 'build',
      settings: { maxIterations: 50 },
      steps: [
        {
          id: 'build',
          name: 'Build',
          type: 'agent' as const,
          toolMode: 'builder' as const,
          phase: 'build',
          transitions: [],
        },
      ],
    }

    vi.mocked(loadAllWorkflows).mockResolvedValue([mockWorkflow])
    vi.mocked(findWorkflowById).mockReturnValue(mockWorkflow)

    const result = await runOrchestrator(mockOptions)

    expect(executeWorkflow).toHaveBeenCalledWith(mockWorkflow, mockOptions)
    expect(result.finalAction.type).toBe('DONE')
    expect(result.iterations).toBe(1)
  })

  it('should prefer options.workflowId over runtime config', async () => {
    vi.mocked(getRuntimeConfig).mockReturnValue({
      activeWorkflowId: 'config-wf',
    } as any)
    vi.mocked(loadAllWorkflows).mockResolvedValue([])
    vi.mocked(findWorkflowById).mockReturnValue(undefined)

    await expect(runOrchestrator({ ...mockOptions, workflowId: 'override' })).rejects.toThrow(
      'Workflow "override" not found',
    )
    expect(findWorkflowById).toHaveBeenCalledWith('override', [])
  })
})
