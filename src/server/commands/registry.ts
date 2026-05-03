/**
 * Command Registry
 *
 * Discovers, loads, and manages commands from the commands directory.
 * Defaults are loaded from bundled defaults/ and are never copied to user config.
 * User items override defaults by ID.
 */

import { writeFile, mkdir, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import { pathExists, getDefaultIds, loadItemsFromDir } from '../shared/item-loader.js'
import type { CommandDefinition } from './types.js'

const __bundleDir = dirname(fileURLToPath(import.meta.url))
const DEFAULTS_DIR = join(__bundleDir, 'defaults')
const DEFAULTS_DIR_ALT = join(__bundleDir, 'command-defaults')
const COMMAND_EXTENSION = '.command.md'

function getCommandsDir(configDir: string): string {
  return join(configDir, 'commands')
}

export async function loadDefaultCommands(): Promise<CommandDefinition[]> {
  let defaults = await loadItemsFromDir<CommandDefinition>(DEFAULTS_DIR, {
    extension: COMMAND_EXTENSION,
    logName: 'command',
  })
  if (!defaults.length) {
    defaults = await loadItemsFromDir<CommandDefinition>(DEFAULTS_DIR_ALT, {
      extension: COMMAND_EXTENSION,
      logName: 'command',
    })
  }
  return defaults
}

export async function loadUserCommands(configDir: string): Promise<CommandDefinition[]> {
  return loadItemsFromDir<CommandDefinition>(getCommandsDir(configDir), {
    extension: COMMAND_EXTENSION,
    logName: 'command',
  })
}

export async function loadAllCommands(configDir: string): Promise<CommandDefinition[]> {
  const [defaultCommands, userCommands] = await Promise.all([loadDefaultCommands(), loadUserCommands(configDir)])

  const commandMap = new Map<string, CommandDefinition>()
  for (const cmd of defaultCommands) {
    commandMap.set(cmd.metadata.id, cmd)
  }
  for (const cmd of userCommands) {
    commandMap.set(cmd.metadata.id, cmd)
  }

  return Array.from(commandMap.values())
}

export async function getDefaultCommandIds(): Promise<string[]> {
  const ids = await getDefaultIds(DEFAULTS_DIR, COMMAND_EXTENSION)
  if (ids.length) return ids
  return getDefaultIds(DEFAULTS_DIR_ALT, COMMAND_EXTENSION)
}

export async function getDefaultCommandContent(commandId: string): Promise<CommandDefinition | null> {
  const defaults = await loadDefaultCommands()
  return defaults.find((c) => c.metadata.id === commandId) ?? null
}

export async function isDefaultCommand(commandId: string): Promise<boolean> {
  const defaultIds = await getDefaultCommandIds()
  return defaultIds.includes(commandId)
}

export function findCommandById(commandId: string, commands: CommandDefinition[]): CommandDefinition | undefined {
  return commands.find((c) => c.metadata.id === commandId)
}

export async function commandExists(configDir: string, commandId: string): Promise<boolean> {
  return pathExists(join(getCommandsDir(configDir), `${commandId}${COMMAND_EXTENSION}`))
}

export async function saveCommand(configDir: string, command: CommandDefinition): Promise<void> {
  const commandsDir = getCommandsDir(configDir)
  if (!(await pathExists(commandsDir))) {
    await mkdir(commandsDir, { recursive: true })
  }
  const filePath = join(commandsDir, `${command.metadata.id}${COMMAND_EXTENSION}`)
  const content = matter.stringify(command.prompt, command.metadata)
  await writeFile(filePath, content, 'utf-8')
}

export async function deleteCommand(
  configDir: string,
  commandId: string,
): Promise<{ success: boolean; reason?: string }> {
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
  const [defaultIds, userCommands] = await Promise.all([getDefaultCommandIds(), loadUserCommands(configDir)])
  return userCommands.map((cmd) => cmd.metadata.id).filter((id) => defaultIds.includes(id))
}
