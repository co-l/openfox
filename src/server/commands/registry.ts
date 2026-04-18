/**
 * Command Registry
 *
 * Discovers, loads, and manages commands from the commands directory.
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getBundleDir, dirExists, ensureDir, loadItems, saveItem, deleteItem, findById, getDefaultIds, restoreDefault } from './registry-utils.js'
import type { CommandDefinition } from './types.js'

const DEFAULTS_DIR = 'defaults'
const DEFAULTS_DIR_ALT = 'command-defaults'
const COMMAND_EXTENSION = '.command.md'

function getCommandsDir(configDir: string): string {
  return join(configDir, 'commands')
}

export async function ensureDefaultCommands(configDir: string): Promise<void> {
  const bundleDir = getBundleDir()
  const commandsDir = getCommandsDir(configDir)
  await ensureDir(commandsDir)

  const ids = await getDefaultIds(bundleDir, DEFAULTS_DIR, COMMAND_EXTENSION)
  for (const id of ids) {
    if (!(await restoreDefault(commandsDir, bundleDir, DEFAULTS_DIR, id, COMMAND_EXTENSION))) {
      await restoreDefault(commandsDir, bundleDir, DEFAULTS_DIR_ALT, id, COMMAND_EXTENSION)
    }
  }
}

export async function loadAllCommands(configDir: string): Promise<CommandDefinition[]> {
  return loadItems<CommandDefinition>(getCommandsDir(configDir), COMMAND_EXTENSION)
}

export async function getDefaultCommandIds(): Promise<string[]> {
  const bundleDir = getBundleDir()
  const ids = await getDefaultIds(bundleDir, DEFAULTS_DIR, COMMAND_EXTENSION)
  if (ids.length) return ids
  return getDefaultIds(bundleDir, DEFAULTS_DIR_ALT, COMMAND_EXTENSION)
}

export async function restoreDefaultCommand(configDir: string, commandId: string): Promise<boolean> {
  const bundleDir = getBundleDir()
  const commandsDir = getCommandsDir(configDir)
  return restoreDefault(commandsDir, bundleDir, DEFAULTS_DIR, commandId, COMMAND_EXTENSION)
    || restoreDefault(commandsDir, bundleDir, DEFAULTS_DIR_ALT, commandId, COMMAND_EXTENSION)
}

export async function getModifiedDefaultCommandIds(configDir: string): Promise<string[]> {
  const bundleDir = getBundleDir()
  const ids = await getDefaultCommandIds()
  const files = (await readdir(join(bundleDir, DEFAULTS_DIR))).filter(f => f.endsWith(COMMAND_EXTENSION))
  return files.map(f => f.replace(COMMAND_EXTENSION, '')).filter(id => ids.includes(id))
}

export async function restoreAllDefaultCommands(configDir: string): Promise<number> {
  const ids = await getDefaultCommandIds()
  let count = 0
  for (const id of ids) {
    if (await restoreDefaultCommand(configDir, id)) count++
  }
  return count
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

export async function deleteCommand(configDir: string, commandId: string): Promise<boolean> {
  return deleteItem(getCommandsDir(configDir), commandId, COMMAND_EXTENSION)
}