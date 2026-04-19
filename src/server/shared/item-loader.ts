/**
 * Shared utilities for loading default/user items from directories.
 * Used by agents, workflows, commands, and skills registries.
 */

import { readdir, readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { constants } from 'node:fs'
import matter from 'gray-matter'
import { logger } from '../utils/logger.js'

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

export async function getDefaultIds(dir: string, extension: string): Promise<string[]> {
  try {
    const files = (await readdir(dir)).filter(f => f.endsWith(extension))
    return files.map(f => f.replace(extension, ''))
  } catch {
    return []
  }
}

export interface ItemDefinition<T extends { id: string } = { id: string }> {
  metadata: T
  prompt: string
}

export interface ItemLoaderOptions {
  extension: string
  logName: string
}

export async function loadItemsFromDir<T extends ItemDefinition>(
  dir: string,
  options: ItemLoaderOptions
): Promise<T[]> {
  if (!await pathExists(dir)) {
    return []
  }
  let files: string[]
  try {
    files = (await readdir(dir)).filter(f => f.endsWith(options.extension))
  } catch {
    return []
  }
  const items: T[] = []
  for (const file of files) {
    try {
      const raw = await readFile(join(dir, file), 'utf-8')
      const { data, content } = matter(raw)
      if ((data as { id?: string }).id && content.trim()) {
        items.push({
          metadata: data as T['metadata'],
          prompt: content.trim(),
        } as T)
      } else {
        logger.warn(`Skipping invalid ${options.logName} file`, { file })
      }
    } catch (err) {
      logger.warn(`Failed to parse ${options.logName} file`, {
        file,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return items
}