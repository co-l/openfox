import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseSlashInvocation, workflowParamsFromArgs, expandCommandPrompt, resolveSlashLaunch } from './slash.js'

describe('parseSlashInvocation', () => {
  it('returns null for non-slash prompts', () => {
    expect(parseSlashInvocation('just some text')).toBeNull()
    expect(parseSlashInvocation('')).toBeNull()
    expect(parseSlashInvocation('   ')).toBeNull()
  })

  it('parses a bare command id with no args', () => {
    expect(parseSlashInvocation('/lint')).toEqual({ id: 'lint', args: [] })
  })

  it('parses args, trimming surrounding whitespace', () => {
    expect(parseSlashInvocation('  /fixme crash src/a.ts  ')).toEqual({
      id: 'fixme',
      args: ['crash', 'src/a.ts'],
    })
  })

  it('treats a lone slash as invalid', () => {
    expect(parseSlashInvocation('/')).toBeNull()
    expect(parseSlashInvocation('/ ')).toBeNull()
  })

  it('keeps slashes inside args (e.g. file paths)', () => {
    expect(parseSlashInvocation('/run vitest run src/x.test.ts')).toEqual({
      id: 'run',
      args: ['vitest', 'run', 'src/x.test.ts'],
    })
  })
})

describe('workflowParamsFromArgs', () => {
  it('maps positional args to declared parameters in order', () => {
    const params = workflowParamsFromArgs(
      [
        { id: 'issue', position: 0 },
        { id: 'file', position: 1 },
      ],
      ['crash', 'src/a.ts'],
    )
    expect(params).toEqual({ issue: 'crash', file: 'src/a.ts' })
  })

  it('honors non-zero positions when declared', () => {
    const params = workflowParamsFromArgs(
      [
        { id: 'file', position: 1 },
        { id: 'issue', position: 0 },
      ],
      ['crash', 'src/a.ts'],
    )
    expect(params).toEqual({ issue: 'crash', file: 'src/a.ts' })
  })

  it('omits keys for missing args', () => {
    const params = workflowParamsFromArgs([{ id: 'a' }, { id: 'b' }], ['only-a'])
    expect(params).toEqual({ a: 'only-a' })
    expect('b' in params).toBe(false)
  })

  it('ignores surplus args beyond declared parameters', () => {
    const params = workflowParamsFromArgs([{ id: 'a' }], ['one', 'two'])
    expect(params).toEqual({ a: 'one' })
  })

  it('falls back to positional keys when the workflow declares no parameters', () => {
    expect(workflowParamsFromArgs(undefined, ['x', 'y'])).toEqual({ '0': 'x', '1': 'y' })
    expect(workflowParamsFromArgs([], ['x'])).toEqual({ '0': 'x' })
  })
})

describe('expandCommandPrompt', () => {
  const TEMPLATE = 'Fix the {{issue}} bug in {{file}}.'

  it('substitutes named params from positional args in template order', () => {
    const { prompt, unfilledParams } = expandCommandPrompt(TEMPLATE, ['crash', 'src/a.ts'])
    expect(prompt).toBe('Fix the crash bug in src/a.ts.')
    expect(unfilledParams).toEqual([])
  })

  it('replaces repeated placeholders everywhere', () => {
    const { prompt } = expandCommandPrompt('repeat {{x}} then {{x}} again', ['hi'])
    expect(prompt).toBe('repeat hi then hi again')
  })

  it('reports unfilled params and keeps placeholders intact', () => {
    const { prompt, unfilledParams } = expandCommandPrompt(TEMPLATE, ['crash'])
    expect(prompt).toBe('Fix the crash bug in {{file}}.')
    expect(unfilledParams).toEqual(['file'])
  })

  it('deduplicates param names in template order', () => {
    const { prompt, unfilledParams } = expandCommandPrompt('{{b}} and {{a}} and {{b}}', ['1', '2'])
    expect(prompt).toBe('1 and 2 and 1')
    expect(unfilledParams).toEqual([])
  })

  it('leaves a template with no placeholders untouched', () => {
    const { prompt, unfilledParams } = expandCommandPrompt('Plain instruction', [])
    expect(prompt).toBe('Plain instruction')
    expect(unfilledParams).toEqual([])
  })
})

describe('resolveSlashLaunch (filesystem-backed)', () => {
  let root: string
  let configDir: string

  const fixtureWorkflow = (id: string, parameters?: { id: string; position?: number; required?: boolean }[]) => ({
    metadata: {
      id,
      name: `WF ${id}`,
      description: 'fixture',
      version: '1.0.0',
      ...(parameters ? { parameters } : {}),
    },
    entryStep: 'do_it',
    settings: { maxIterations: 5 },
    steps: [
      {
        id: 'do_it',
        name: 'Do it',
        type: 'agent',
        phase: 'build',
        prompt: 'Do the thing',
        transitions: [{ when: { type: 'always' }, goto: '$done' }],
      },
    ],
    startCondition: { type: 'always' },
  })

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'openfox-slash-'))
    configDir = join(root, 'config')
    await mkdir(join(configDir, 'commands'), { recursive: true })
    await mkdir(join(configDir, 'workflows'), { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('returns null for a non-slash prompt', async () => {
    expect(await resolveSlashLaunch(configDir, undefined, 'plain text')).toBeNull()
  })

  it('resolves a workflow from the user config dir with mapped params', async () => {
    await writeFile(
      join(configDir, 'workflows', 'fixit.workflow.json'),
      JSON.stringify(
        fixtureWorkflow('fixit', [
          { id: 'issue', position: 0 },
          { id: 'file', position: 1 },
        ]),
      ),
    )
    const resolved = await resolveSlashLaunch(configDir, undefined, '/fixit crash src/a.ts')
    expect(resolved).toEqual({ kind: 'workflow', workflowId: 'fixit', params: { issue: 'crash', file: 'src/a.ts' } })
  })

  it('resolves a workflow with no declared parameters to empty params', async () => {
    await writeFile(join(configDir, 'workflows', 'simple.workflow.json'), JSON.stringify(fixtureWorkflow('simple')))
    const resolved = await resolveSlashLaunch(configDir, undefined, '/simple')
    expect(resolved).toEqual({ kind: 'workflow', workflowId: 'simple', params: {} })
  })

  it('resolves a workflow when all required params are supplied', async () => {
    await writeFile(
      join(configDir, 'workflows', 'reqwf.workflow.json'),
      JSON.stringify(
        fixtureWorkflow('reqwf', [
          { id: 'issue', position: 0, required: true },
          { id: 'file', position: 1, required: false },
        ]),
      ),
    )
    const resolved = await resolveSlashLaunch(configDir, undefined, '/reqwf crash')
    expect(resolved).toMatchObject({ kind: 'workflow', workflowId: 'reqwf', params: { issue: 'crash' } })
  })

  it('refuses a workflow with a missing required param (caller degrades to raw text)', async () => {
    await writeFile(
      join(configDir, 'workflows', 'reqwf.workflow.json'),
      JSON.stringify(
        fixtureWorkflow('reqwf', [
          { id: 'issue', position: 0, required: true },
          { id: 'file', position: 1, required: false },
        ]),
      ),
    )
    expect(await resolveSlashLaunch(configDir, undefined, '/reqwf')).toBeNull()
  })

  it('resolves a bundled default workflow', async () => {
    const resolved = await resolveSlashLaunch(configDir, undefined, '/default')
    expect(resolved?.kind).toBe('workflow')
    expect(resolved).toMatchObject({ workflowId: 'default' })
  })

  it('expands a command prompt and surfaces its agent mode', async () => {
    await writeFile(
      join(configDir, 'commands', 'fixme.command.md'),
      '---\nid: fixme\nname: Fix me\nagentMode: builder\n---\n\nFix the {{issue}} bug in {{file}}.',
    )
    const resolved = await resolveSlashLaunch(configDir, undefined, '/fixme crash src/a.ts')
    expect(resolved).toEqual({ kind: 'command', prompt: 'Fix the crash bug in src/a.ts.', agentMode: 'builder' })
  })

  it('prefers workflows over commands when an id collides', async () => {
    await writeFile(join(configDir, 'workflows', 'both.workflow.json'), JSON.stringify(fixtureWorkflow('both')))
    await writeFile(join(configDir, 'commands', 'both.command.md'), '---\nid: both\nname: Both\n---\n\nCommand body')
    const resolved = await resolveSlashLaunch(configDir, undefined, '/both')
    expect(resolved?.kind).toBe('workflow')
    expect(resolved).toMatchObject({ workflowId: 'both' })
  })

  it('returns null for a command with unfilled params (caller falls back to raw text)', async () => {
    await writeFile(
      join(configDir, 'commands', 'fixme.command.md'),
      '---\nid: fixme\nname: Fix me\n---\n\nFix the {{issue}} bug in {{file}}.',
    )
    expect(await resolveSlashLaunch(configDir, undefined, '/fixme crash')).toBeNull()
  })

  it('returns null for an unknown slash id', async () => {
    expect(await resolveSlashLaunch(configDir, undefined, '/nope whatever')).toBeNull()
  })

  it('resolves a project-scoped command when a project dir is provided', async () => {
    const projectDir = join(root, 'proj')
    await mkdir(join(projectDir, '.openfox', 'commands'), { recursive: true })
    await writeFile(
      join(projectDir, '.openfox', 'commands', 'projcmd.command.md'),
      '---\nid: projcmd\nname: Project cmd\n---\n\nProject {{thing}}',
    )
    const resolved = await resolveSlashLaunch(configDir, projectDir, '/projcmd widget')
    expect(resolved).toEqual({ kind: 'command', prompt: 'Project widget' })
  })

  it('resolves a command with no placeholders even with extra args', async () => {
    await writeFile(join(configDir, 'commands', 'ping.command.md'), '---\nid: ping\nname: Ping\n---\n\nSay hello')
    const resolved = await resolveSlashLaunch(configDir, undefined, '/ping extra args')
    expect(resolved).toEqual({ kind: 'command', prompt: 'Say hello' })
  })
})
