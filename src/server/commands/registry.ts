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

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULTS_DIR = join(__dirname, 'defaults')
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

  let defaultFiles: string[]
  try {
    defaultFiles = (await readdir(DEFAULTS_DIR)).filter(f => f.endsWith(COMMAND_EXTENSION))
  } catch {
    logger.warn('No bundled command defaults found', { dir: DEFAULTS_DIR })
    return
  }

  for (const file of defaultFiles) {
    const targetPath = join(commandsDir, file)
    if (!await dirExists(targetPath)) {
      try {
        await copyFile(join(DEFAULTS_DIR, file), targetPath)
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
