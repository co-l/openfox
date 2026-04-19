/**
 * Command Registry
 *
 * Discovers, loads, and manages commands from the commands directory.
 * Defaults are loaded from bundled defaults/ and are never copied to user config.
 * User items override defaults by ID.
 */

import { join } from 'node:path'
import { getBundleDir, dirExists, loadItems, saveItem, deleteItem, findById, getDefaultIds, loadDefaults } from './registry-utils.js'
import type { CommandDefinition } from './types.js'

const DEFAULTS_DIR = 'defaults'
const DEFAULTS_DIR_ALT = 'command-defaults'
const COMMAND_EXTENSION = '.command.md'

function getCommandsDir(configDir: string): string {
  return join(configDir, 'commands')
}

export async function loadDefaultCommands(): Promise<CommandDefinition[]> {
  const bundleDir = getBundleDir()
  let defaults = await loadDefaults<CommandDefinition>(bundleDir, DEFAULTS_DIR, COMMAND_EXTENSION)
  if (!defaults.length) {
    defaults = await loadDefaults<CommandDefinition>(bundleDir, DEFAULTS_DIR_ALT, COMMAND_EXTENSION)
  }
  return defaults
}

export async function loadUserCommands(configDir: string): Promise<CommandDefinition[]> {
  return loadItems<CommandDefinition>(getCommandsDir(configDir), COMMAND_EXTENSION)
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

export async function getDefaultCommandIds(): Promise<string[]> {
  const bundleDir = getBundleDir()
  const ids = await getDefaultIds(bundleDir, DEFAULTS_DIR, COMMAND_EXTENSION)
  if (ids.length) return ids
  return getDefaultIds(bundleDir, DEFAULTS_DIR_ALT, COMMAND_EXTENSION)
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
  return findById(commandId, commands)
}

export async function commandExists(configDir: string, commandId: string): Promise<boolean> {
  return dirExists(join(getCommandsDir(configDir), `${commandId}${COMMAND_EXTENSION}`))
}

export async function saveCommand(configDir: string, command: CommandDefinition): Promise<void> {
  return saveItem(getCommandsDir(configDir), command.metadata.id, COMMAND_EXTENSION, command)
}

export async function deleteCommand(configDir: string, commandId: string): Promise<{ success: boolean; reason?: string }> {
  const isDefault = await isDefaultCommand(commandId)
  if (isDefault) {
    return { success: false, reason: 'Cannot delete built-in defaults' }
  }
  const deleted = await deleteItem(getCommandsDir(configDir), commandId, COMMAND_EXTENSION)
  return { success: deleted }
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