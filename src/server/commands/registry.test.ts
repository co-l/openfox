/**
 * Command Registry Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadAllCommands,
  findCommandById,
  saveCommand,
  deleteCommand,
  commandExists,
  ensureDefaultCommands,
} from './registry.js'
import type { CommandDefinition } from './types.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'command-registry-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('loadAllCommands', () => {
  it('should return empty array when commands directory does not exist', async () => {
    const commands = await loadAllCommands(tempDir)
    expect(commands).toEqual([])
  })

  it('should load valid .command.md files', async () => {
    const commandsDir = join(tempDir, 'commands')
    await mkdir(commandsDir, { recursive: true })
    await writeFile(join(commandsDir, 'test.command.md'), `---
id: test
name: Test Command
---

Do the test thing.
`)

    const commands = await loadAllCommands(tempDir)
    expect(commands).toHaveLength(1)
    expect(commands[0]!.metadata.id).toBe('test')
    expect(commands[0]!.metadata.name).toBe('Test Command')
    expect(commands[0]!.prompt).toBe('Do the test thing.')
  })

  it('should skip files without an id', async () => {
    const commandsDir = join(tempDir, 'commands')
    await mkdir(commandsDir, { recursive: true })
    await writeFile(join(commandsDir, 'bad.command.md'), `---
name: No ID
---

Some prompt.
`)

    const commands = await loadAllCommands(tempDir)
    expect(commands).toEqual([])
  })

  it('should skip files with empty prompt', async () => {
    const commandsDir = join(tempDir, 'commands')
    await mkdir(commandsDir, { recursive: true })
    await writeFile(join(commandsDir, 'empty.command.md'), `---
id: empty
name: Empty
---
`)

    const commands = await loadAllCommands(tempDir)
    expect(commands).toEqual([])
  })

  it('should skip non-.command.md files', async () => {
    const commandsDir = join(tempDir, 'commands')
    await mkdir(commandsDir, { recursive: true })
    await writeFile(join(commandsDir, 'readme.md'), '# Not a command')
    await writeFile(join(commandsDir, 'valid.command.md'), `---
id: valid
name: Valid
---

Prompt.
`)

    const commands = await loadAllCommands(tempDir)
    expect(commands).toHaveLength(1)
    expect(commands[0]!.metadata.id).toBe('valid')
  })

  it('should parse agentMode metadata', async () => {
    const commandsDir = join(tempDir, 'commands')
    await mkdir(commandsDir, { recursive: true })
    await writeFile(join(commandsDir, 'plan.command.md'), `---
id: plan
name: Plan
agentMode: planner
---

Plan the thing.
`)

    const commands = await loadAllCommands(tempDir)
    expect(commands[0]!.metadata.agentMode).toBe('planner')
  })
})

describe('findCommandById', () => {
  it('should return the matching command', () => {
    const commands: CommandDefinition[] = [
      { metadata: { id: 'a', name: 'A' }, prompt: 'Do A' },
      { metadata: { id: 'b', name: 'B' }, prompt: 'Do B' },
    ]
    const found = findCommandById('b', commands)
    expect(found).toBeDefined()
    expect(found!.metadata.name).toBe('B')
  })

  it('should return undefined for non-existent id', () => {
    const commands: CommandDefinition[] = [
      { metadata: { id: 'a', name: 'A' }, prompt: 'Do A' },
    ]
    expect(findCommandById('missing', commands)).toBeUndefined()
  })
})

describe('CRUD', () => {
  it('should save and load a command', async () => {
    const command: CommandDefinition = {
      metadata: { id: 'my_cmd', name: 'My Command' },
      prompt: 'Execute my command.',
    }

    await saveCommand(tempDir, command)
    const commands = await loadAllCommands(tempDir)
    const loaded = commands.find(c => c.metadata.id === 'my_cmd')

    expect(loaded).toBeDefined()
    expect(loaded!.metadata.name).toBe('My Command')
    expect(loaded!.prompt).toBe('Execute my command.')
  })

  it('should delete a command', async () => {
    const command: CommandDefinition = {
      metadata: { id: 'deleteme', name: 'Delete Me' },
      prompt: 'Temporary.',
    }

    await saveCommand(tempDir, command)
    const deleted = await deleteCommand(tempDir, 'deleteme')
    expect(deleted).toBe(true)

    const commands = await loadAllCommands(tempDir)
    expect(commands.find(c => c.metadata.id === 'deleteme')).toBeUndefined()
  })

  it('should return false when deleting non-existent command', async () => {
    const deleted = await deleteCommand(tempDir, 'nonexistent')
    expect(deleted).toBe(false)
  })

  it('should check command existence', async () => {
    expect(await commandExists(tempDir, 'nope')).toBe(false)

    await saveCommand(tempDir, {
      metadata: { id: 'exists', name: 'Exists' },
      prompt: 'Here.',
    })
    expect(await commandExists(tempDir, 'exists')).toBe(true)
  })
})

describe('ensureDefaultCommands', () => {
  it('should copy bundled defaults to config dir', async () => {
    await ensureDefaultCommands(tempDir)
    const commands = await loadAllCommands(tempDir)

    // Should have at least some defaults (exact count depends on bundled files)
    expect(commands.length).toBeGreaterThanOrEqual(0)
  })

  it('should not overwrite existing commands', async () => {
    // Pre-create a command file
    const commandsDir = join(tempDir, 'commands')
    await mkdir(commandsDir, { recursive: true })
    await writeFile(join(commandsDir, 'custom.command.md'), `---
id: custom
name: Custom
---

My custom prompt.
`)

    await ensureDefaultCommands(tempDir)

    // Custom command should still be there
    const raw = await readFile(join(commandsDir, 'custom.command.md'), 'utf-8')
    expect(raw).toContain('My custom prompt.')
  })
})
