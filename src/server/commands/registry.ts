/**
 * Command Registry
 *
 * Discovers, loads, and manages commands from the commands directory.
 */

import { readdir, readFile, writeFile, copyFile, mkdir, access, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import type { CommandDefinition, CommandMetadata } from './types.js'
import { logger } from '../utils/logger.js'

const __bundleDir = dirname(fileURLToPath(import.meta.url))
const DEFAULTS_DIR = join(__bundleDir, 'defaults')
const DEFAULTS_DIR_ALT = join(__bundleDir, 'command-defaults')
const COMMAND_EXTENSION = '.command.md'

// ============================================================================
// Directory Helpers
// ============================================================================

function getCommandsDir(configDir: string): string {
  return join(configDir, 'commands')
}

async function dirExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

// ============================================================================
// Default Commands Installation
// ============================================================================

/**
 * Copy bundled default commands to the config commands directory if they don't already exist.
 */
export async function ensureDefaultCommands(configDir: string): Promise<void> {
  const commandsDir = getCommandsDir(configDir)

  if (!await dirExists(commandsDir)) {
    await mkdir(commandsDir, { recursive: true })
  }

  // Find bundled defaults (try dev path first, then production path)
  let defaultFiles: string[]
  let sourceDir: string
  try {
    defaultFiles = (await readdir(DEFAULTS_DIR)).filter(f => f.endsWith(COMMAND_EXTENSION))
    sourceDir = DEFAULTS_DIR
  } catch {
    try {
      defaultFiles = (await readdir(DEFAULTS_DIR_ALT)).filter(f => f.endsWith(COMMAND_EXTENSION))
      sourceDir = DEFAULTS_DIR_ALT
    } catch {
      logger.warn('No bundled command defaults found', { dir: DEFAULTS_DIR })
      return
    }
  }

  for (const file of defaultFiles) {
    const targetPath = join(commandsDir, file)
    if (!await dirExists(targetPath)) {
      try {
        await copyFile(join(sourceDir, file), targetPath)
        logger.info('Installed default command', { file })
      } catch (err) {
        logger.error('Failed to copy default command', { file, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }
}

// ============================================================================
// Command Loading
// ============================================================================

/**
 * Load all commands from the commands directory.
 */
export async function loadAllCommands(configDir: string): Promise<CommandDefinition[]> {
  const commandsDir = getCommandsDir(configDir)

  if (!await dirExists(commandsDir)) {
    return []
  }

  let files: string[]
  try {
    files = (await readdir(commandsDir)).filter(f => f.endsWith(COMMAND_EXTENSION))
  } catch {
    return []
  }

  const commands: CommandDefinition[] = []
  for (const file of files) {
    try {
      const raw = await readFile(join(commandsDir, file), 'utf-8')
      const { data, content } = matter(raw)
      const metadata = data as CommandMetadata
      if (metadata.id && content.trim()) {
        commands.push({ metadata, prompt: content.trim() })
      } else {
        logger.warn('Skipping invalid command file', { file })
      }
    } catch (err) {
      logger.warn('Failed to parse command file', { file, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return commands
}

// ============================================================================
// Default Restoration
// ============================================================================

/**
 * Get the list of command IDs that have bundled defaults.
 */
export async function getDefaultCommandIds(): Promise<string[]> {
  for (const dir of [DEFAULTS_DIR, DEFAULTS_DIR_ALT]) {
    try {
      const files = (await readdir(dir)).filter(f => f.endsWith(COMMAND_EXTENSION))
      return files.map(f => f.replace(COMMAND_EXTENSION, ''))
    } catch { /* try next */ }
  }
  return []
}

/**
 * Restore a single command to its bundled default by re-copying from defaults.
 */
export async function restoreDefaultCommand(configDir: string, commandId: string): Promise<boolean> {
  const filename = `${commandId}${COMMAND_EXTENSION}`
  for (const dir of [DEFAULTS_DIR, DEFAULTS_DIR_ALT]) {
    const sourcePath = join(dir, filename)
    if (await dirExists(sourcePath)) {
      const targetPath = join(getCommandsDir(configDir), filename)
      await copyFile(sourcePath, targetPath)
      return true
    }
  }
  return false
}

/**
 * Return the IDs of default commands whose user copy differs from the bundled version.
 */
export async function getModifiedDefaultCommandIds(configDir: string): Promise<string[]> {
  const defaultIds = await getDefaultCommandIds()
  const modified: string[] = []

  for (const id of defaultIds) {
    const filename = `${id}${COMMAND_EXTENSION}`
    const userPath = join(getCommandsDir(configDir), filename)

    let bundledContent: string | null = null
    for (const dir of [DEFAULTS_DIR, DEFAULTS_DIR_ALT]) {
      try {
        bundledContent = await readFile(join(dir, filename), 'utf-8')
        break
      } catch { /* try next */ }
    }
    if (!bundledContent) continue

    try {
      const userContent = await readFile(userPath, 'utf-8')
      if (userContent !== bundledContent) {
        modified.push(id)
      }
    } catch {
      // User file doesn't exist
    }
  }

  return modified
}

/**
 * Restore all commands to their bundled defaults.
 */
export async function restoreAllDefaultCommands(configDir: string): Promise<number> {
  const ids = await getDefaultCommandIds()
  let count = 0
  for (const id of ids) {
    if (await restoreDefaultCommand(configDir, id)) count++
  }
  return count
}

// ============================================================================
// Command Lookup
// ============================================================================

/**
 * Find a command by ID from a list of loaded commands.
 */
export function findCommandById(commandId: string, commands: CommandDefinition[]): CommandDefinition | undefined {
  return commands.find(c => c.metadata.id === commandId)
}

// ============================================================================
// Command CRUD
// ============================================================================

/**
 * Check if a command file exists.
 */
export async function commandExists(configDir: string, commandId: string): Promise<boolean> {
  const filePath = join(getCommandsDir(configDir), `${commandId}${COMMAND_EXTENSION}`)
  return dirExists(filePath)
}

/**
 * Save a command definition to disk.
 */
export async function saveCommand(configDir: string, command: CommandDefinition): Promise<void> {
  const commandsDir = getCommandsDir(configDir)
  if (!await dirExists(commandsDir)) {
    await mkdir(commandsDir, { recursive: true })
  }
  const filePath = join(commandsDir, `${command.metadata.id}${COMMAND_EXTENSION}`)
  const content = matter.stringify(command.prompt, command.metadata)
  await writeFile(filePath, content, 'utf-8')
}

/**
 * Delete a command from disk.
 */
export async function deleteCommand(configDir: string, commandId: string): Promise<boolean> {
  const filePath = join(getCommandsDir(configDir), `${commandId}${COMMAND_EXTENSION}`)
  try {
    await unlink(filePath)
    return true
  } catch {
    return false
  }
}
