/**
 * Command Registry Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadAllCommands,
  loadDefaultCommands,
  loadUserCommands,
  findCommandById,
  saveCommand,
  deleteCommand,
  commandExists,
  isDefaultCommand,
  getDefaultCommandIds,
} from './registry.js'
import type { CommandDefinition } from './types.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'command-registry-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('loadDefaultCommands', () => {
  it('should load all bundled default commands', async () => {
    const defaults = await loadDefaultCommands()
    expect(defaults.length).toBeGreaterThanOrEqual(1)
  })
})

describe('loadUserCommands', () => {
  it('should return empty array when commands directory does not exist', async () => {
    const commands = await loadUserCommands(tempDir)
    expect(commands).toEqual([])
  })

  it('should load valid .command.md files', async () => {
    const commandsDir = join(tempDir, 'commands')
    await mkdir(commandsDir, { recursive: true })
    await writeFile(
      join(commandsDir, 'test.command.md'),
      `---
id: test
name: Test Command
---

Do the test thing.
`,
    )

    const commands = await loadUserCommands(tempDir)
    expect(commands).toHaveLength(1)
    expect(commands[0]!.metadata.id).toBe('test')
    expect(commands[0]!.metadata.name).toBe('Test Command')
    expect(commands[0]!.prompt).toBe('Do the test thing.')
  })

  it('should skip files without an id', async () => {
    const commandsDir = join(tempDir, 'commands')
    await mkdir(commandsDir, { recursive: true })
    await writeFile(
      join(commandsDir, 'bad.command.md'),
      `---
name: No ID
---

Some prompt.
`,
    )

    const commands = await loadUserCommands(tempDir)
    expect(commands).toEqual([])
  })

  it('should skip files with empty prompt', async () => {
    const commandsDir = join(tempDir, 'commands')
    await mkdir(commandsDir, { recursive: true })
    await writeFile(
      join(commandsDir, 'empty.command.md'),
      `---
id: empty
name: Empty
---
`,
    )

    const commands = await loadUserCommands(tempDir)
    expect(commands).toEqual([])
  })

  it('should skip non-.command.md files', async () => {
    const commandsDir = join(tempDir, 'commands')
    await mkdir(commandsDir, { recursive: true })
    await writeFile(join(commandsDir, 'readme.md'), '# Not a command')
    await writeFile(
      join(commandsDir, 'valid.command.md'),
      `---
id: valid
name: Valid
---

Prompt.
`,
    )

    const commands = await loadUserCommands(tempDir)
    expect(commands).toHaveLength(1)
    expect(commands[0]!.metadata.id).toBe('valid')
  })
})

describe('loadAllCommands', () => {
  it('should merge defaults and user commands', async () => {
    const commandsDir = join(tempDir, 'commands')
    await mkdir(commandsDir, { recursive: true })
    await writeFile(
      join(commandsDir, 'test.command.md'),
      `---
id: test
name: Test Command
---

Do the test thing.
`,
    )

    const defaults = await loadDefaultCommands()
    const commands = await loadAllCommands(tempDir)
    // Should have user command plus all defaults
    expect(commands.some((c) => c.metadata.id === 'test')).toBe(true)
    expect(commands.length).toBeGreaterThanOrEqual(defaults.length + 1)
  })

  it('should give precedence to user commands over defaults', async () => {
    const commandsDir = join(tempDir, 'commands')
    await mkdir(commandsDir, { recursive: true })
    await writeFile(
      join(commandsDir, 'custom.command.md'),
      `---
id: custom
name: Custom Command
---

Custom prompt.
`,
    )

    const commands = await loadAllCommands(tempDir)
    const custom = commands.find((c) => c.metadata.id === 'custom')
    expect(custom).toBeDefined()
    expect(custom!.prompt).toBe('Custom prompt.')
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
    const commands: CommandDefinition[] = [{ metadata: { id: 'a', name: 'A' }, prompt: 'Do A' }]
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
    const loaded = commands.find((c) => c.metadata.id === 'my_cmd')

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
    const result = await deleteCommand(tempDir, 'deleteme')
    expect(result.success).toBe(true)

    const commands = await loadAllCommands(tempDir)
    expect(commands.find((c) => c.metadata.id === 'deleteme')).toBeUndefined()
  })

  it('should not delete built-in default commands', async () => {
    const defaults = await loadDefaultCommands()
    if (defaults.length > 0) {
      const result = await deleteCommand(tempDir, defaults[0]!.metadata.id)
      expect(result.success).toBe(false)
      expect(result.reason).toBe('Cannot delete built-in defaults')
    }
  })

  it('should return false when deleting non-existent command', async () => {
    const result = await deleteCommand(tempDir, 'nonexistent')
    expect(result.success).toBe(false)
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

describe('isDefaultCommand', () => {
  it('should correctly identify built-in default commands', async () => {
    const defaults = await loadDefaultCommands()
    for (const cmd of defaults) {
      expect(await isDefaultCommand(cmd.metadata.id)).toBe(true)
    }
    expect(await isDefaultCommand('nonexistent-command')).toBe(false)
  })
})

describe('getDefaultCommandIds', () => {
  it('should return all default command IDs', async () => {
    const ids = await getDefaultCommandIds()
    expect(ids.length).toBeGreaterThan(0)
    expect(ids).toContain('init')
  })
})
