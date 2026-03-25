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
  completeExecuteMock,
  passExecuteMock,
  failExecuteMock,
  getCriteriaExecuteMock,
  addCriterionExecuteMock,
  updateCriterionExecuteMock,
  removeCriterionExecuteMock,
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
  completeExecuteMock: vi.fn(async () => ({ success: true, output: 'complete', durationMs: 1, truncated: false })),
  passExecuteMock: vi.fn(async () => ({ success: true, output: 'pass', durationMs: 1, truncated: false })),
  failExecuteMock: vi.fn(async () => ({ success: true, output: 'fail', durationMs: 1, truncated: false })),
  getCriteriaExecuteMock: vi.fn(async () => ({ success: true, output: 'get criteria', durationMs: 1, truncated: false })),
  addCriterionExecuteMock: vi.fn(async () => ({ success: true, output: 'add criterion', durationMs: 1, truncated: false })),
  updateCriterionExecuteMock: vi.fn(async () => ({ success: true, output: 'update criterion', durationMs: 1, truncated: false })),
  removeCriterionExecuteMock: vi.fn(async () => ({ success: true, output: 'remove criterion', durationMs: 1, truncated: false })),
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
  completeCriterionTool: { name: 'complete_criterion', definition: { type: 'function', function: { name: 'complete_criterion', description: 'Complete', parameters: {} } }, execute: completeExecuteMock },
  passCriterionTool: { name: 'pass_criterion', definition: { type: 'function', function: { name: 'pass_criterion', description: 'Pass', parameters: {} } }, execute: passExecuteMock },
  failCriterionTool: { name: 'fail_criterion', definition: { type: 'function', function: { name: 'fail_criterion', description: 'Fail', parameters: {} } }, execute: failExecuteMock },
}))
vi.mock('./planner-criteria.js', () => ({
  getCriteriaTool: { name: 'get_criteria', definition: { type: 'function', function: { name: 'get_criteria', description: 'Get', parameters: {} } }, execute: getCriteriaExecuteMock },
  addCriterionTool: { name: 'add_criterion', definition: { type: 'function', function: { name: 'add_criterion', description: 'Add', parameters: {} } }, execute: addCriterionExecuteMock },
  updateCriterionTool: { name: 'update_criterion', definition: { type: 'function', function: { name: 'update_criterion', description: 'Update', parameters: {} } }, execute: updateCriterionExecuteMock },
  removeCriterionTool: { name: 'remove_criterion', definition: { type: 'function', function: { name: 'remove_criterion', description: 'Remove', parameters: {} } }, execute: removeCriterionExecuteMock },
}))
vi.mock('./todo.js', () => ({
  todoWriteTool: { name: 'todo_write', definition: { type: 'function', function: { name: 'todo_write', description: 'Todo', parameters: {} } }, execute: todoExecuteMock },
  setTodoUpdateCallback: vi.fn(),
  getTodos: vi.fn(() => []),
  clearTodos: vi.fn(),
}))
vi.mock('./load-skill.js', () => ({
  loadSkillTool: { name: 'load_skill', definition: { type: 'function', function: { name: 'load_skill', description: 'Load Skill', parameters: {} } }, execute: loadSkillExecuteMock },
}))
vi.mock('./web-fetch.js', () => ({
  webFetchTool: { name: 'web_fetch', definition: { type: 'function', function: { name: 'web_fetch', description: 'Web Fetch', parameters: {} } }, execute: webFetchExecuteMock },
}))

import { AskUserInterrupt } from './ask.js'
import { PathAccessDeniedError } from './path-security.js'
import { createToolRegistry, getToolRegistryForMode } from './index.js'

describe('tool registries', () => {
  it('returns the correct tool sets for each mode', () => {
    expect(getToolRegistryForMode('planner').tools.map((tool) => tool.name)).toEqual([
      'read_file', 'glob', 'grep', 'web_fetch', 'run_command', 'git', 'get_criteria', 'add_criterion', 'update_criterion', 'remove_criterion', 'call_sub_agent', 'load_skill',
    ])
    expect(getToolRegistryForMode('builder').tools.map((tool) => tool.name)).toEqual([
      'read_file', 'glob', 'grep', 'web_fetch', 'write_file', 'edit_file', 'run_command', 'ask_user', 'complete_criterion', 'get_criteria', 'todo_write', 'call_sub_agent', 'load_skill',
    ])
    expect(getToolRegistryForMode('verifier').tools.map((tool) => tool.name)).toEqual([
      'read_file', 'glob', 'grep', 'web_fetch', 'run_command', 'pass_criterion', 'fail_criterion',
    ])
    expect(createToolRegistry()).toBe(getToolRegistryForMode('builder'))
  })

  it('executes tools, reports unknown tools, and catches generic failures', async () => {
    const registry = getToolRegistryForMode('builder')
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
    const registry = getToolRegistryForMode('builder')
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    askExecuteMock.mockRejectedValueOnce(new AskUserInterrupt('call-1', 'Need input?'))
    await expect(registry.execute('ask_user', {}, context)).rejects.toBeInstanceOf(AskUserInterrupt)

    completeExecuteMock.mockRejectedValueOnce(new PathAccessDeniedError(['/etc/passwd'], 'complete_criterion'))
    await expect(registry.execute('complete_criterion', {}, context)).rejects.toBeInstanceOf(PathAccessDeniedError)
  })
})
