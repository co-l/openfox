import { describe, expect, it, vi, beforeEach } from 'vitest'

const {
  readExecuteMock,
  writeExecuteMock,
  editExecuteMock,
  shellExecuteMock,
  askExecuteMock,
  sessionMetadataExecuteMock,
  todoExecuteMock,
  loadSkillExecuteMock,
  webFetchExecuteMock,
  callSubAgentExecuteMock,
  webSearchExecuteMock,
} = vi.hoisted(() => ({
  readExecuteMock: vi.fn(async () => ({ success: true, output: 'read', durationMs: 1, truncated: false })),
  writeExecuteMock: vi.fn(async () => ({ success: true, output: 'write', durationMs: 1, truncated: false })),
  editExecuteMock: vi.fn(async () => ({ success: true, output: 'edit', durationMs: 1, truncated: false })),
  shellExecuteMock: vi.fn(async () => ({ success: true, output: 'shell', durationMs: 1, truncated: false })),
  askExecuteMock: vi.fn(async () => ({ success: true, output: 'ask', durationMs: 1, truncated: false })),
  sessionMetadataExecuteMock: vi.fn(async () => ({
    success: true,
    output: 'session_metadata',
    durationMs: 1,
    truncated: false,
  })),
  todoExecuteMock: vi.fn(async () => ({ success: true, output: 'todo', durationMs: 1, truncated: false })),
  loadSkillExecuteMock: vi.fn(async () => ({ success: true, output: 'skill', durationMs: 1, truncated: false })),
  webFetchExecuteMock: vi.fn(async () => ({ success: true, output: 'web_fetch', durationMs: 1, truncated: false })),
  callSubAgentExecuteMock: vi.fn(async () => ({
    success: true,
    output: 'sub-agent result',
    durationMs: 1,
    truncated: false,
  })),
  webSearchExecuteMock: vi.fn(async () => ({
    success: true,
    output: '[1] Web Search Result\n    URL: https://example.com\n    Content snippet',
    durationMs: 1,
    truncated: false,
  })),
}))

vi.mock('./read.js', () => ({
  readFileTool: {
    name: 'read_file',
    definition: { type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } },
    execute: readExecuteMock,
  },
}))
vi.mock('./write.js', () => ({
  writeFileTool: {
    name: 'write_file',
    definition: { type: 'function', function: { name: 'write_file', description: 'Write', parameters: {} } },
    execute: writeExecuteMock,
  },
}))
vi.mock('./edit.js', () => ({
  editFileTool: {
    name: 'edit_file',
    definition: { type: 'function', function: { name: 'edit_file', description: 'Edit', parameters: {} } },
    execute: editExecuteMock,
  },
}))
vi.mock('./shell.js', () => ({
  runCommandTool: {
    name: 'run_command',
    definition: { type: 'function', function: { name: 'run_command', description: 'Shell', parameters: {} } },
    execute: shellExecuteMock,
  },
}))
vi.mock('./ask.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ask.js')>()
  return {
    ...actual,
    askUserTool: {
      name: 'ask_user',
      definition: { type: 'function', function: { name: 'ask_user', description: 'Ask', parameters: {} } },
      execute: askExecuteMock,
    },
  }
})
vi.mock('./session-metadata.js', () => ({
  sessionMetadataTool: {
    name: 'session_metadata',
    definition: {
      type: 'function',
      function: { name: 'session_metadata', description: 'Session Metadata', parameters: {} },
    },
    execute: sessionMetadataExecuteMock,
  },
}))
vi.mock('./todo.js', () => ({
  todoTool: {
    name: 'todo',
    definition: { type: 'function', function: { name: 'todo', description: 'Todo', parameters: {} } },
    execute: todoExecuteMock,
  },
}))
vi.mock('./load-skill.js', () => ({
  loadSkillTool: {
    name: 'load_skill',
    definition: { type: 'function', function: { name: 'load_skill', description: 'Load Skill', parameters: {} } },
    execute: loadSkillExecuteMock,
  },
}))
vi.mock('./web-fetch.js', () => ({
  webFetchTool: {
    name: 'web_fetch',
    definition: { type: 'function', function: { name: 'web_fetch', description: 'Web Fetch', parameters: {} } },
    execute: webFetchExecuteMock,
  },
}))

vi.mock('./web-search.js', () => ({
  webSearchTool: {
    name: 'web_search',
    definition: {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Web Search',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            max_results: { type: 'number' },
          },
          required: ['query'],
        },
      },
    },
    execute: webSearchExecuteMock,
  },
}))

vi.mock('./step-done.js', () => ({
  stepDoneTool: {
    name: 'step_done',
    definition: { type: 'function', function: { name: 'step_done', description: 'Step Done', parameters: {} } },
    execute: vi.fn(async () => ({ success: true, output: 'done', durationMs: 1, truncated: false })),
  },
}))

vi.mock('./sub-agent.js', () => ({
  callSubAgentTool: {
    name: 'call_sub_agent',
    definition: {
      type: 'function',
      function: { name: 'call_sub_agent', description: 'Call Sub-Agent', parameters: {} },
    },
    execute: callSubAgentExecuteMock,
  },
}))

vi.mock('../agents/registry.js', () => ({
  loadAllAgentsDefault: vi.fn(),
  findAgentById: vi.fn(),
  getSubAgents: vi.fn(),
}))

import { AskUserInterrupt } from './ask.js'
import { PathAccessDeniedError } from './path-security.js'
import { createToolRegistry, getToolRegistryForAgent, createRegistryFromTools } from './index.js'
import type { AgentDefinition } from '../agents/types.js'

const builderDef: AgentDefinition = {
  metadata: {
    id: 'builder',
    name: 'Builder',
    description: 'Builds',
    subagent: false,
    allowedTools: [
      'read_file',
      'web_fetch',
      'write_file',
      'edit_file',
      'run_command',
      'ask_user',
      'session_metadata',
      'call_sub_agent',
      'load_skill',
    ],
  },
  prompt: 'Build mode.',
}

const builderWithReturnValueDef: AgentDefinition = {
  metadata: {
    id: 'builder',
    name: 'Builder',
    description: 'Builds',
    subagent: false,
    allowedTools: [
      'read_file',
      'web_fetch',
      'write_file',
      'edit_file',
      'run_command',
      'ask_user',
      'session_metadata',
      'call_sub_agent',
      'load_skill',
      'return_value',
    ],
  },
  prompt: 'Build mode.',
}

const verifierDef: AgentDefinition = {
  metadata: {
    id: 'verifier',
    name: 'Verifier',
    description: 'Verifies',
    subagent: true,
    allowedTools: ['read_file', 'run_command', 'session_metadata', 'web_fetch'],
  },
  prompt: 'Verify.',
}

const plannerDef: AgentDefinition = {
  metadata: {
    id: 'planner',
    name: 'Planner',
    description: 'Plans',
    subagent: false,
    allowedTools: [
      'read_file',
      'web_fetch',
      'run_command',
      'ask_user',
      'session_metadata',
      'call_sub_agent',
      'load_skill',
      'background_process',
      'mcp_config',
      'dev_server',
    ],
  },
  prompt: 'Plan mode.',
}

describe('tool registries', () => {
  it('getToolRegistryForAgent returns correct tools for top-level agent', () => {
    const registry = getToolRegistryForAgent(builderDef)
    const toolNames = registry.tools.map((t) => t.name)
    expect(toolNames).toContain('read_file')
    expect(toolNames).toContain('write_file')
    expect(toolNames).toContain('edit_file')
    expect(toolNames).toContain('run_command')
    expect(toolNames).not.toContain('return_value')
  })

  it('getToolRegistryForAgent filters out return_value even if in allowedTools', () => {
    const registry = getToolRegistryForAgent(builderWithReturnValueDef)
    const toolNames = registry.tools.map((t) => t.name)
    expect(toolNames).not.toContain('return_value')
  })

  it('getToolRegistryForAgent returns correct tools for sub-agent with return_value', () => {
    const registry = getToolRegistryForAgent(verifierDef)
    const toolNames = registry.tools.map((t) => t.name)
    expect(toolNames).toContain('read_file')
    expect(toolNames).toContain('session_metadata')
    expect(toolNames).toContain('return_value')
  })

  it('createToolRegistry returns all available tools', () => {
    const registry = createToolRegistry()
    const toolNames = registry.tools.map((t) => t.name)
    expect(toolNames).toContain('read_file')
    expect(toolNames).toContain('write_file')
    expect(toolNames).toContain('run_command')
    expect(toolNames).toContain('session_metadata')
  })

  it('executes tools, reports unknown tools, and catches generic failures', async () => {
    const registry = getToolRegistryForAgent(builderDef)
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    await expect(registry.execute('write_file', { path: 'a.ts' }, context)).resolves.toMatchObject({
      success: true,
      output: 'write',
    })
    await expect(registry.execute('missing', {}, context)).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('Unknown tool: missing'),
    })

    editExecuteMock.mockRejectedValueOnce(new Error('edit exploded'))
    await expect(registry.execute('edit_file', { path: 'a.ts' }, context)).resolves.toMatchObject({
      success: false,
      error: 'edit exploded',
    })
  })

  it('rethrows ask-user and path access interrupts instead of swallowing them', async () => {
    const registry = getToolRegistryForAgent(builderDef)
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    askExecuteMock.mockRejectedValueOnce(new AskUserInterrupt('call-1', 'Need input?'))
    await expect(registry.execute('ask_user', {}, context)).rejects.toBeInstanceOf(AskUserInterrupt)

    sessionMetadataExecuteMock.mockRejectedValueOnce(new PathAccessDeniedError(['/etc/passwd'], 'session_metadata'))
    await expect(registry.execute('session_metadata', {}, context)).rejects.toBeInstanceOf(PathAccessDeniedError)
  })

  it('allows execution of authorized tools', async () => {
    const registry = getToolRegistryForAgent(builderDef)
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    const result = await registry.execute('read_file', { path: 'test.ts' }, context)

    expect(result).toMatchObject({
      success: true,
      output: 'read',
    })
  })

  it('allows always-allowed tools (step_done) even with empty allowedTools', async () => {
    const emptyAgentDef: AgentDefinition = {
      metadata: {
        id: 'empty',
        name: 'Empty',
        description: 'No tools',
        subagent: false,
        allowedTools: [],
      },
      prompt: 'Empty',
    }

    const registry = getToolRegistryForAgent(emptyAgentDef)
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    const stepResult = await registry.execute('step_done', {}, context)
    expect(stepResult).toMatchObject({ success: true, output: 'done' })
  })

  it('denies non-always-allowed tools (including read_file) when allowedTools is empty', async () => {
    const emptyAgentDef: AgentDefinition = {
      metadata: {
        id: 'empty',
        name: 'Empty',
        description: 'No tools',
        subagent: false,
        allowedTools: [],
      },
      prompt: 'Empty',
    }

    const registry = getToolRegistryForAgent(emptyAgentDef)
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    const readResult = await registry.execute('read_file', { path: 'test.ts' }, context)
    expect(readResult).toMatchObject({
      success: false,
      error: expect.stringContaining("not available in 'empty' mode"),
    })

    const writeResult = await registry.execute('write_file', { path: 'test.ts' }, context)
    expect(writeResult).toMatchObject({
      success: false,
      error: expect.stringContaining("not available in 'empty' mode"),
    })
  })

  it('planner cannot use write_file — gets permission denied with planner-specific message', async () => {
    const registry = getToolRegistryForAgent(plannerDef)
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    const result = await registry.execute('write_file', { path: 'test.ts' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain("not available in 'planner' mode")
    expect(result.error).toContain('write_file')
  })

  it('planner cannot use edit_file — gets permission denied', async () => {
    const registry = getToolRegistryForAgent(plannerDef)
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    const result = await registry.execute('edit_file', { path: 'test.ts' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain("not available in 'planner' mode")
    expect(result.error).toContain('edit_file')
  })

  it('planner can use read_file (in allowedTools)', async () => {
    const registry = getToolRegistryForAgent(plannerDef)
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    const result = await registry.execute('read_file', { path: 'test.ts' }, context)

    expect(result).toMatchObject({ success: true, output: 'read' })
  })

  it('planner can use step_done (always-allowed tool)', async () => {
    const registry = getToolRegistryForAgent(plannerDef)
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    const result = await registry.execute('step_done', {}, context)

    expect(result).toMatchObject({ success: true, output: 'done' })
  })

  it('planner can use MCP tools (always-allowed)', async () => {
    const { setMcpTools } = await import('./index.js')
    const mcpTool = {
      name: 'github_create_issue',
      definition: {
        type: 'function' as const,
        function: { name: 'github_create_issue', description: 'Create issue', parameters: {} },
      },
      execute: vi.fn(async () => ({ success: true, output: 'issue created', durationMs: 1, truncated: false })),
    }
    setMcpTools([mcpTool])

    const registry = getToolRegistryForAgent(plannerDef)
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    const result = await registry.execute('github_create_issue', { title: 'test' }, context)

    expect(result).toMatchObject({ success: true, output: 'issue created' })

    // Cleanup
    setMcpTools([])
  })

  it('builder can still use write_file (unchanged)', async () => {
    const registry = getToolRegistryForAgent(builderDef)
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    const result = await registry.execute('write_file', { path: 'test.ts' }, context)

    expect(result).toMatchObject({ success: true, output: 'write' })
  })

  it('web_search is accessible when in allowedTools', async () => {
    const defWithSearch: AgentDefinition = {
      metadata: {
        id: 'searcher',
        name: 'Searcher',
        description: 'Searches',
        subagent: false,
        allowedTools: ['read_file', 'web_search'],
      },
      prompt: 'Search mode.',
    }

    const registry = getToolRegistryForAgent(defWithSearch)
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    const result = await registry.execute('web_search', { query: 'hello world' }, context)

    expect(result).toMatchObject({ success: true, output: expect.stringContaining('Web Search Result') })
  })

  it('web_search is blocked when not in allowedTools', async () => {
    const registry = getToolRegistryForAgent(builderDef)
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    const result = await registry.execute('web_search', { query: 'test' }, context)

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("Tool 'web_search' is not available"),
    })
  })

  it('tool definitions are identical across planner and builder (vLLM cache preserved)', () => {
    const plannerRegistry = getToolRegistryForAgent(plannerDef)
    const builderRegistry = getToolRegistryForAgent(builderDef)

    const plannerDefs = plannerRegistry.definitions.map((d) => d.function.name).sort()
    const builderDefs = builderRegistry.definitions.map((d) => d.function.name).sort()

    expect(plannerDefs).toEqual(builderDefs)
    expect(plannerDefs).not.toContain('return_value')
  })

  it('enforces permissions when tool is in registry but not in allowed list', async () => {
    const allToolsRegistry = createToolRegistry()
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    const tools = allToolsRegistry.tools.filter((t) => t.name === 'write_file')
    const allowedTools = ['read_file']

    const restrictedRegistry = createRegistryFromTools(tools, allowedTools)

    const result = await restrictedRegistry.execute('write_file', { path: 'test.ts' }, context)

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("Tool 'write_file' is not in your allowed tools list"),
    })
    expect(result.error).toContain('Available: read_file')
  })

  it('blocks unauthorized tools in sub-agent registry', async () => {
    const verifierRegistry = getToolRegistryForAgent(verifierDef)
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    const result = await verifierRegistry.execute('write_file', { path: 'test.ts' }, context)

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('Unknown tool: write_file'),
    })
  })

  it('allows authorized tools in sub-agent registry', async () => {
    const verifierRegistry = getToolRegistryForAgent(verifierDef)
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    const result = await verifierRegistry.execute('read_file', { path: 'test.ts' }, context)

    expect(result).toMatchObject({
      success: true,
      output: 'read',
    })
  })

  it('allows return_value to be executed in sub-agent registry', async () => {
    const verifierRegistry = getToolRegistryForAgent(verifierDef)
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    const result = await verifierRegistry.execute('return_value', { content: 'test' }, context)

    expect(result.success).toBe(true)
  })

  it('allows granular tool permissions like session_metadata:get,add', async () => {
    const allToolsRegistry = createToolRegistry()
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    const tools = allToolsRegistry.tools.filter((t) => t.name === 'session_metadata')
    const allowedTools = ['session_metadata:get,add']

    const restrictedRegistry = createRegistryFromTools(tools, allowedTools)

    const result = await restrictedRegistry.execute('session_metadata', { action: 'get', key: 'criteria' }, context)

    expect(result.success).toBe(true)
  })

  describe('sub-agent alias resolution', () => {
    const mockExplorerDef = {
      metadata: {
        id: 'explorer',
        name: 'Explorer',
        description: 'Explore',
        subagent: true,
        allowedTools: ['read_file', 'run_command', 'web_fetch'],
      },
      prompt: 'Explore.',
    }
    const mockVerifierDef = {
      metadata: {
        id: 'verifier',
        name: 'Verifier',
        description: 'Verify',
        subagent: true,
        allowedTools: ['read_file', 'run_command', 'session_metadata', 'web_fetch'],
      },
      prompt: 'Verify.',
    }
    const mockAgents = [mockExplorerDef, mockVerifierDef]

    beforeEach(async () => {
      vi.clearAllMocks()
      const { loadAllAgentsDefault, findAgentById } = await import('../agents/registry.js')
      vi.mocked(loadAllAgentsDefault).mockResolvedValue(mockAgents)
      vi.mocked(findAgentById).mockImplementation((id: string, agents: typeof mockAgents) =>
        agents.find((a: (typeof mockAgents)[0]) => a.metadata.id === id),
      )
    })

    it('redirects unknown tool name matching sub-agent ID to call_sub_agent', async () => {
      const allToolsRegistry = createToolRegistry()
      const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

      const result = await allToolsRegistry.execute('explorer', { prompt: 'find the entry point' }, context)

      expect(result.success).toBe(true)
      expect(result.output).toBe('sub-agent result')
      expect(callSubAgentExecuteMock).toHaveBeenCalledWith(
        { subAgentType: 'explorer', prompt: 'find the entry point' },
        context,
      )
    })

    it('extracts prompt from query or task fallback keys', async () => {
      const allToolsRegistry = createToolRegistry()
      const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

      await allToolsRegistry.execute('explorer', { query: 'find the entry point' }, context)
      expect(callSubAgentExecuteMock).toHaveBeenCalledWith(
        { subAgentType: 'explorer', prompt: 'find the entry point' },
        expect.anything(),
      )

      callSubAgentExecuteMock.mockClear()
      await allToolsRegistry.execute('explorer', { task: 'find the entry point' }, context)
      expect(callSubAgentExecuteMock).toHaveBeenCalledWith(
        { subAgentType: 'explorer', prompt: 'find the entry point' },
        expect.anything(),
      )
    })

    it('works for any sub-agent ID, not just explorer', async () => {
      const allToolsRegistry = createToolRegistry()
      const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

      const result = await allToolsRegistry.execute('verifier', { prompt: 'verify the criteria' }, context)

      expect(result.success).toBe(true)
      expect(callSubAgentExecuteMock).toHaveBeenCalledWith(
        { subAgentType: 'verifier', prompt: 'verify the criteria' },
        expect.anything(),
      )
    })

    it('returns unknown tool error if name does not match any sub-agent', async () => {
      const allToolsRegistry = createToolRegistry()
      const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

      const result = await allToolsRegistry.execute('nonexistent_tool', { prompt: 'test' }, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Unknown tool: nonexistent_tool')
      expect(callSubAgentExecuteMock).not.toHaveBeenCalled()
    })

    it('does not redirect if call_sub_agent is not in the tool map', async () => {
      const allToolsRegistry = createToolRegistry()
      const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

      const tools = allToolsRegistry.tools.filter((t) => t.name !== 'call_sub_agent')
      const registry = createRegistryFromTools(
        tools,
        tools.map((t) => t.name),
      )

      const result = await registry.execute('explorer', { prompt: 'test' }, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Unknown tool: explorer')
      expect(callSubAgentExecuteMock).not.toHaveBeenCalled()
    })

    it('definitions array does not include sub-agent aliases', () => {
      const allToolsRegistry = createToolRegistry()
      const defNames = allToolsRegistry.definitions.map((d) => d.function.name)
      expect(defNames).not.toContain('explorer')
      expect(defNames).not.toContain('verifier')
      expect(defNames).toContain('call_sub_agent')
    })
  })
})
