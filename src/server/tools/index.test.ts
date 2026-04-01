import { describe, expect, it, vi } from 'vitest'

const {
  readExecuteMock,
  writeExecuteMock,
  editExecuteMock,
  shellExecuteMock,
  globExecuteMock,
  grepExecuteMock,
  gitExecuteMock,
  askExecuteMock,
  criterionExecuteMock,
  todoExecuteMock,
  loadSkillExecuteMock,
  webFetchExecuteMock,
} = vi.hoisted(() => ({
  readExecuteMock: vi.fn(async () => ({ success: true, output: 'read', durationMs: 1, truncated: false })),
  writeExecuteMock: vi.fn(async () => ({ success: true, output: 'write', durationMs: 1, truncated: false })),
  editExecuteMock: vi.fn(async () => ({ success: true, output: 'edit', durationMs: 1, truncated: false })),
  shellExecuteMock: vi.fn(async () => ({ success: true, output: 'shell', durationMs: 1, truncated: false })),
  globExecuteMock: vi.fn(async () => ({ success: true, output: 'glob', durationMs: 1, truncated: false })),
  grepExecuteMock: vi.fn(async () => ({ success: true, output: 'grep', durationMs: 1, truncated: false })),
  gitExecuteMock: vi.fn(async () => ({ success: true, output: 'git', durationMs: 1, truncated: false })),
  askExecuteMock: vi.fn(async () => ({ success: true, output: 'ask', durationMs: 1, truncated: false })),
  criterionExecuteMock: vi.fn(async () => ({ success: true, output: 'criterion', durationMs: 1, truncated: false })),
  todoExecuteMock: vi.fn(async () => ({ success: true, output: 'todo', durationMs: 1, truncated: false })),
  loadSkillExecuteMock: vi.fn(async () => ({ success: true, output: 'skill', durationMs: 1, truncated: false })),
  webFetchExecuteMock: vi.fn(async () => ({ success: true, output: 'web_fetch', durationMs: 1, truncated: false })),
}))

vi.mock('./read.js', () => ({ readFileTool: { name: 'read_file', definition: { type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } }, execute: readExecuteMock } }))
vi.mock('./write.js', () => ({ writeFileTool: { name: 'write_file', definition: { type: 'function', function: { name: 'write_file', description: 'Write', parameters: {} } }, execute: writeExecuteMock } }))
vi.mock('./edit.js', () => ({ editFileTool: { name: 'edit_file', definition: { type: 'function', function: { name: 'edit_file', description: 'Edit', parameters: {} } }, execute: editExecuteMock } }))
vi.mock('./shell.js', () => ({ runCommandTool: { name: 'run_command', definition: { type: 'function', function: { name: 'run_command', description: 'Shell', parameters: {} } }, execute: shellExecuteMock } }))
vi.mock('./glob.js', () => ({ globTool: { name: 'glob', definition: { type: 'function', function: { name: 'glob', description: 'Glob', parameters: {} } }, execute: globExecuteMock } }))
vi.mock('./grep.js', () => ({ grepTool: { name: 'grep', definition: { type: 'function', function: { name: 'grep', description: 'Grep', parameters: {} } }, execute: grepExecuteMock } }))
vi.mock('./git.js', () => ({ gitTool: { name: 'git', definition: { type: 'function', function: { name: 'git', description: 'Git', parameters: {} } }, execute: gitExecuteMock } }))
vi.mock('./ask.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ask.js')>()
  return {
    ...actual,
    askUserTool: { name: 'ask_user', definition: { type: 'function', function: { name: 'ask_user', description: 'Ask', parameters: {} } }, execute: askExecuteMock },
  }
})
vi.mock('./criterion.js', () => ({
  criterionTool: { name: 'criterion', definition: { type: 'function', function: { name: 'criterion', description: 'Criterion', parameters: {} } }, execute: criterionExecuteMock },
}))
vi.mock('./todo.js', () => ({
  todoTool: { name: 'todo', definition: { type: 'function', function: { name: 'todo', description: 'Todo', parameters: {} } }, execute: todoExecuteMock },
}))
vi.mock('./load-skill.js', () => ({
  loadSkillTool: { name: 'load_skill', definition: { type: 'function', function: { name: 'load_skill', description: 'Load Skill', parameters: {} } }, execute: loadSkillExecuteMock },
}))
vi.mock('./web-fetch.js', () => ({
  webFetchTool: { name: 'web_fetch', definition: { type: 'function', function: { name: 'web_fetch', description: 'Web Fetch', parameters: {} } }, execute: webFetchExecuteMock },
}))

import { AskUserInterrupt } from './ask.js'
import { PathAccessDeniedError } from './path-security.js'
import { createToolRegistry, getToolRegistryForAgent, createRegistryFromTools } from './index.js'
import type { AgentDefinition } from '../agents/types.js'

const builderDef: AgentDefinition = {
  metadata: { id: 'builder', name: 'Builder', description: 'Builds', subagent: false, allowedTools: ['read_file', 'glob', 'grep', 'web_fetch', 'write_file', 'edit_file', 'run_command', 'ask_user', 'criterion', 'todo', 'call_sub_agent', 'load_skill'] },
  prompt: 'Build mode.',
}

const verifierDef: AgentDefinition = {
  metadata: { id: 'verifier', name: 'Verifier', description: 'Verifies', subagent: true, allowedTools: ['read_file', 'run_command', 'criterion', 'web_fetch'] },
  prompt: 'Verify.',
}

describe('tool registries', () => {
  it('getToolRegistryForAgent returns correct tools for top-level agent', () => {
    const registry = getToolRegistryForAgent(builderDef)
    const toolNames = registry.tools.map(t => t.name)
    expect(toolNames).toContain('read_file')
    expect(toolNames).toContain('write_file')
    expect(toolNames).toContain('edit_file')
    expect(toolNames).toContain('run_command')
    expect(toolNames).not.toContain('return_value')
  })

  it('getToolRegistryForAgent returns correct tools for sub-agent with return_value', () => {
    const registry = getToolRegistryForAgent(verifierDef)
    const toolNames = registry.tools.map(t => t.name)
    expect(toolNames).toContain('read_file')
    expect(toolNames).toContain('criterion')
    expect(toolNames).toContain('return_value')
  })

  it('createToolRegistry returns all available tools', () => {
    const registry = createToolRegistry()
    const toolNames = registry.tools.map(t => t.name)
    expect(toolNames).toContain('read_file')
    expect(toolNames).toContain('write_file')
    expect(toolNames).toContain('run_command')
    expect(toolNames).toContain('criterion')
  })

  it('executes tools, reports unknown tools, and catches generic failures', async () => {
    const registry = getToolRegistryForAgent(builderDef)
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    await expect(registry.execute('write_file', { path: 'a.ts' }, context)).resolves.toMatchObject({ success: true, output: 'write' })
    await expect(registry.execute('missing', {}, context)).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('Unknown tool: missing'),
    })

    editExecuteMock.mockRejectedValueOnce(new Error('edit exploded'))
    await expect(registry.execute('edit_file', { path: 'a.ts' }, context)).resolves.toMatchObject({ success: false, error: 'edit exploded' })
  })

  it('rethrows ask-user and path access interrupts instead of swallowing them', async () => {
    const registry = getToolRegistryForAgent(builderDef)
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    askExecuteMock.mockRejectedValueOnce(new AskUserInterrupt('call-1', 'Need input?'))
    await expect(registry.execute('ask_user', {}, context)).rejects.toBeInstanceOf(AskUserInterrupt)

    criterionExecuteMock.mockRejectedValueOnce(new PathAccessDeniedError(['/etc/passwd'], 'criterion'))
    await expect(registry.execute('criterion', {}, context)).rejects.toBeInstanceOf(PathAccessDeniedError)
  })

  it('blocks execution of unauthorized tools with permission error', async () => {
    const registry = getToolRegistryForAgent(builderDef)
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    const result = await registry.execute('git', {}, context)

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("Unknown tool: git"),
    })
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

  it('handles empty allowedTools list by blocking all tools', async () => {
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

    const result = await registry.execute('read_file', { path: 'test.ts' }, context)

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("Unknown tool: read_file"),
    })
  })

  it('enforces permissions when tool is in registry but not in allowed list', async () => {
    const allToolsRegistry = createToolRegistry()
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    const tools = allToolsRegistry.tools.filter(t => t.name === 'read_file')
    const allowedTools = ['write_file']

    const restrictedRegistry = createRegistryFromTools(tools, allowedTools)

    const result = await restrictedRegistry.execute('read_file', { path: 'test.ts' }, context)

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("Tool 'read_file' is not in your allowed tools list"),
    })
    expect(result.error).toContain('Available: write_file')
  })

  it('blocks unauthorized tools in sub-agent registry', async () => {
    const verifierRegistry = getToolRegistryForAgent(verifierDef)
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    const result = await verifierRegistry.execute('write_file', { path: 'test.ts' }, context)

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("Unknown tool: write_file"),
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
})
