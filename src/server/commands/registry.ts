/**
 * Command Registry
 *
 * Discovers, loads, and manages commands from the commands directory.
 * Defaults are loaded from bundled defaults/ and are never copied to user config.
 * User items override defaults by ID.
 */

import { readdir, readFile, writeFile, mkdir, access, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import { logger } from '../utils/logger.js'
import type { CommandDefinition } from './types.js'

const __bundleDir = dirname(fileURLToPath(import.meta.url))
const DEFAULTS_DIR = join(__bundleDir, 'defaults')
const DEFAULTS_DIR_ALT = join(__bundleDir, 'command-defaults')
const COMMAND_EXTENSION = '.command.md'

function getCommandsDir(configDir: string): string {
  return join(configDir, 'commands')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function loadCommandsFromDir(dir: string): Promise<CommandDefinition[]> {
  if (!await pathExists(dir)) {
    return []
  }
  let files: string[]
  try {
    files = (await readdir(dir)).filter(f => f.endsWith(COMMAND_EXTENSION))
  } catch {
    return []
  }
  const commands: CommandDefinition[] = []
  for (const file of files) {
    try {
      const raw = await readFile(join(dir, file), 'utf-8')
      const { data, content } = matter(raw)
      if ((data as { id?: string }).id && content.trim()) {
        commands.push({
          metadata: data as CommandDefinition['metadata'],
          prompt: content.trim(),
        })
      } else {
        logger.warn('Skipping invalid command file', { file })
      }
    } catch (err) {
      logger.warn('Failed to parse command file', { file, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return commands
}

export async function loadDefaultCommands(): Promise<CommandDefinition[]> {
  let defaults = await loadCommandsFromDir(DEFAULTS_DIR)
  if (!defaults.length) {
    defaults = await loadCommandsFromDir(DEFAULTS_DIR_ALT)
  }
  return defaults
}

export async function loadUserCommands(configDir: string): Promise<CommandDefinition[]> {
  return loadCommandsFromDir(getCommandsDir(configDir))
}

export async function loadAllCommands(configDir: string): Promise<CommandDefinition[]> {
  const [defaultCommands, userCommands] = await Promise.all([
    loadDefaultCommands(),
    loadUserCommands(configDir),
  ])

  const commandMap = new Map<string, CommandDefinition>()
  for (const cmd of defaultCommands) {
    commandMap.set(cmd.metadata.id, cmd)
  }
  for (const cmd of userCommands) {
    commandMap.set(cmd.metadata.id, cmd)
  }

  return Array.from(commandMap.values())
}

async function getDefaultIds(dir: string, extension: string): Promise<string[]> {
  try {
    const files = (await readdir(dir)).filter(f => f.endsWith(extension))
    return files.map(f => f.replace(extension, ''))
  } catch {
    return []
  }
}

export async function getDefaultCommandIds(): Promise<string[]> {
  const ids = await getDefaultIds(DEFAULTS_DIR, COMMAND_EXTENSION)
  if (ids.length) return ids
  return getDefaultIds(DEFAULTS_DIR_ALT, COMMAND_EXTENSION)
}

export async function getDefaultCommandContent(commandId: string): Promise<CommandDefinition | null> {
  const defaults = await loadDefaultCommands()
  return defaults.find(c => c.metadata.id === commandId) ?? null
}

export async function isDefaultCommand(commandId: string): Promise<boolean> {
  const defaultIds = await getDefaultCommandIds()
  return defaultIds.includes(commandId)
}

export function findCommandById(commandId: string, commands: CommandDefinition[]): CommandDefinition | undefined {
  return commands.find(c => c.metadata.id === commandId)
}

export async function commandExists(configDir: string, commandId: string): Promise<boolean> {
  return pathExists(join(getCommandsDir(configDir), `${commandId}${COMMAND_EXTENSION}`))
}

export async function saveCommand(configDir: string, command: CommandDefinition): Promise<void> {
  const commandsDir = getCommandsDir(configDir)
  if (!await pathExists(commandsDir)) {
    await mkdir(commandsDir, { recursive: true })
  }
  const filePath = join(commandsDir, `${command.metadata.id}${COMMAND_EXTENSION}`)
  const content = matter.stringify(command.prompt, command.metadata)
  await writeFile(filePath, content, 'utf-8')
}

export async function deleteCommand(configDir: string, commandId: string): Promise<{ success: boolean; reason?: string }> {
  const isDefault = await isDefaultCommand(commandId)
  if (isDefault) {
    return { success: false, reason: 'Cannot delete built-in defaults' }
  }
  const filePath = join(getCommandsDir(configDir), `${commandId}${COMMAND_EXTENSION}`)
  try {
    await unlink(filePath)
    return { success: true }
  } catch {
    return { success: false }
  }
}

export async function getOverrideCommandIds(configDir: string): Promise<string[]> {
  const [defaultIds, userCommands] = await Promise.all([
    getDefaultCommandIds(),
    loadUserCommands(configDir),
  ])
  return userCommands
    .map(cmd => cmd.metadata.id)
    .filter(id => defaultIds.includes(id))
}