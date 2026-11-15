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
    agent: { toolTimeout: 120000 },
  })),
}))

vi.mock('../../cli/paths.js', () => ({
  getGlobalConfigDir: vi.fn(() => '/mock/config'),
}))

vi.mock('../workflows/registry.js', () => ({
  loadAllWorkflows: vi.fn(async () => []),
  loadWorkflowsWithScope: vi.fn(async () => ({ workflows: [], scopes: new Map() })),
  loadDefaultWorkflows: vi.fn(async () => []),
  loadUserWorkflows: vi.fn(async () => []),
  loadProjectWorkflows: vi.fn(async () => []),
  findWorkflowById: vi.fn(),
  normalizeWorkflowScope: vi.fn((value: unknown) =>
    typeof value === 'string' && ['auto', 'builtin', 'user', 'project'].includes(value) ? value : 'auto',
  ),
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
import {
  loadWorkflowsWithScope,
  loadDefaultWorkflows,
  loadUserWorkflows,
  loadProjectWorkflows,
  findWorkflowById,
  normalizeWorkflowScope,
} from '../workflows/registry.js'
import { executeWorkflow } from '../workflows/executor.js'

/** Stub the merged catalog with the given workflows (all resolved as builtin). */
function mockCatalog(workflows: unknown[], scopes: Map<string, string> = new Map()): void {
  vi.mocked(loadWorkflowsWithScope).mockResolvedValue({ workflows: workflows as never, scopes: scopes as never })
}

const mockOptions: OrchestratorOptions = {
  sessionManager: {
    requireSession: vi.fn(() => ({ workdir: '/mock/project' })),
  } as any,
  sessionId: 'test-session',
  llmClient: {} as any,
  scope: 'auto',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runOrchestrator', () => {
  it('should throw when workflow is not found', async () => {
    mockCatalog([])
    vi.mocked(findWorkflowById).mockReturnValue(undefined)

    await expect(runOrchestrator(mockOptions)).rejects.toThrow('Workflow "default" not found')
  })

  it('should use "default" workflow ID when none specified', async () => {
    mockCatalog([])
    vi.mocked(findWorkflowById).mockReturnValue(undefined)

    await expect(runOrchestrator(mockOptions)).rejects.toThrow('Workflow "default" not found')
    expect(findWorkflowById).toHaveBeenCalledWith('default', [])
  })

  it('should use options.workflowId when provided', async () => {
    mockCatalog([])
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
    mockCatalog([])
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
          phase: 'build',
          transitions: [],
        },
      ],
    }

    mockCatalog([mockWorkflow])
    vi.mocked(findWorkflowById).mockReturnValue(mockWorkflow)

    const result = await runOrchestrator(mockOptions)

    expect(executeWorkflow).toHaveBeenCalledWith(mockWorkflow, mockOptions, undefined, 'builtin')
    expect(result.finalAction.type).toBe('DONE')
    expect(result.iterations).toBe(1)
  })

  it('should prefer options.workflowId over runtime config', async () => {
    vi.mocked(getRuntimeConfig).mockReturnValue({
      activeWorkflowId: 'config-wf',
    } as any)
    mockCatalog([])
    vi.mocked(findWorkflowById).mockReturnValue(undefined)

    await expect(runOrchestrator({ ...mockOptions, workflowId: 'override' })).rejects.toThrow(
      'Workflow "override" not found',
    )
    expect(findWorkflowById).toHaveBeenCalledWith('override', [])
  })

  it('resolves from the user bucket when scope is "user"', async () => {
    const userWorkflow = { metadata: { id: 'review', name: 'Global Review', description: '', version: '1' } }
    vi.mocked(loadUserWorkflows).mockResolvedValue([userWorkflow as never])
    vi.mocked(findWorkflowById).mockReturnValue(userWorkflow as never)

    await runOrchestrator({ ...mockOptions, workflowId: 'review', scope: 'user' })

    expect(loadUserWorkflows).toHaveBeenCalledWith('/mock/config')
    expect(findWorkflowById).toHaveBeenCalledWith('review', [userWorkflow])
    expect(loadWorkflowsWithScope).not.toHaveBeenCalled()
    expect(executeWorkflow).toHaveBeenCalledWith(userWorkflow, expect.anything(), undefined, 'user')
  })

  it('resolves from the project bucket when scope is "project"', async () => {
    const projectWorkflow = { metadata: { id: 'review', name: 'Project Review', description: '', version: '1' } }
    vi.mocked(loadProjectWorkflows).mockResolvedValue([projectWorkflow as never])
    vi.mocked(findWorkflowById).mockReturnValue(projectWorkflow as never)

    await runOrchestrator({ ...mockOptions, workflowId: 'review', scope: 'project' })

    expect(loadProjectWorkflows).toHaveBeenCalledWith('/mock/project')
    expect(loadWorkflowsWithScope).not.toHaveBeenCalled()
    expect(executeWorkflow).toHaveBeenCalledWith(projectWorkflow, expect.anything(), undefined, 'project')
  })

  it('resolves from the builtin bucket when scope is "builtin"', async () => {
    const builtinWorkflow = { metadata: { id: 'review', name: 'Built-in Review', description: '', version: '1' } }
    vi.mocked(loadDefaultWorkflows).mockResolvedValue([builtinWorkflow as never])
    vi.mocked(findWorkflowById).mockReturnValue(builtinWorkflow as never)

    await runOrchestrator({ ...mockOptions, workflowId: 'review', scope: 'builtin' })

    expect(loadDefaultWorkflows).toHaveBeenCalled()
    expect(loadWorkflowsWithScope).not.toHaveBeenCalled()
    expect(executeWorkflow).toHaveBeenCalledWith(builtinWorkflow, expect.anything(), undefined, 'builtin')
  })

  it('falls back to precedence when the requested scope lacks the workflow', async () => {
    const effectiveWorkflow = { metadata: { id: 'review', name: 'Project Review', description: '', version: '1' } }
    vi.mocked(loadUserWorkflows).mockResolvedValue([])
    mockCatalog([effectiveWorkflow])
    vi.mocked(findWorkflowById).mockImplementation((_id, items) =>
      items.length > 0 ? (effectiveWorkflow as never) : undefined,
    )

    const result = await runOrchestrator({ ...mockOptions, workflowId: 'review', scope: 'user' })

    expect(loadWorkflowsWithScope).toHaveBeenCalledWith('/mock/config', '/mock/project')
    expect(executeWorkflow).toHaveBeenCalledWith(effectiveWorkflow, expect.anything(), undefined, 'builtin')
    expect(result.finalAction.type).toBe('DONE')
  })

  it('takes the resolved scope from the same catalog load that supplies the definition', async () => {
    const projectWorkflow = { metadata: { id: 'review', name: 'Project Review', description: '', version: '1' } }
    vi.mocked(loadUserWorkflows).mockResolvedValue([])
    mockCatalog([projectWorkflow], new Map([['review', 'project']]))
    vi.mocked(findWorkflowById).mockReturnValue(projectWorkflow as never)

    await runOrchestrator({ ...mockOptions, workflowId: 'review', scope: 'auto' })

    // A single read of the buckets yields both the definition and its scope.
    expect(loadWorkflowsWithScope).toHaveBeenCalledTimes(1)
    expect(executeWorkflow).toHaveBeenCalledWith(projectWorkflow, expect.anything(), undefined, 'project')
  })

  it('throws when neither the scope bucket nor precedence finds the workflow', async () => {
    vi.mocked(loadUserWorkflows).mockResolvedValue([])
    mockCatalog([])
    vi.mocked(findWorkflowById).mockReturnValue(undefined)

    await expect(runOrchestrator({ ...mockOptions, workflowId: 'missing', scope: 'user' })).rejects.toThrow(
      'Workflow "missing" not found',
    )
  })

  it('normalizes an unknown scope to auto', async () => {
    vi.mocked(normalizeWorkflowScope).mockReturnValue('auto')
    mockCatalog([])
    vi.mocked(findWorkflowById).mockReturnValue(undefined)

    await expect(runOrchestrator({ ...mockOptions, workflowId: 'default', scope: 'system' as never })).rejects.toThrow(
      'Workflow "default" not found',
    )
    expect(loadUserWorkflows).not.toHaveBeenCalled()
    expect(loadWorkflowsWithScope).toHaveBeenCalled()
  })
})
