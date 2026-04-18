import { readdir, readFile, writeFile, copyFile, mkdir, access, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import { logger } from '../utils/logger.js'

export function getBundleDir(): string {
  return dirname(fileURLToPath(import.meta.url))
}

export async function dirExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

export async function ensureDir(path: string): Promise<void> {
  if (!await dirExists(path)) {
    await mkdir(path, { recursive: true })
  }
}

export interface ItemMetadata { id: string }
export interface ItemDefinition<T extends ItemMetadata = ItemMetadata> { metadata: T; prompt: string }

export async function loadItems<T extends ItemDefinition>(
  dir: string,
  extension: string
): Promise<T[]> {
  if (!await dirExists(dir)) return []
  let files: string[]
  try {
    files = (await readdir(dir)).filter(f => f.endsWith(extension))
  } catch {
    return []
  }
  const items: T[] = []
  for (const file of files) {
    try {
      const raw = await readFile(join(dir, file), 'utf-8')
      const { data, content } = matter(raw)
      if ((data as ItemMetadata).id && content.trim()) {
        items.push({ metadata: data as T['metadata'], prompt: content.trim() } as T)
      } else {
        logger.warn(`Skipping invalid ${extension} file`, { file })
      }
    } catch (err) {
      logger.warn(`Failed to parse ${extension} file`, { file, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return items
}

export async function saveItem(
  dir: string,
  id: string,
  extension: string,
  item: { metadata: { id: string }; prompt: string }
): Promise<void> {
  await ensureDir(dir)
  const filePath = join(dir, `${id}${extension}`)
  const content = matter.stringify(item.prompt, item.metadata)
  await writeFile(filePath, content, 'utf-8')
}

export async function deleteItem(dir: string, id: string, extension: string): Promise<boolean> {
  const filePath = join(dir, `${id}${extension}`)
  try {
    await unlink(filePath)
    return true
  } catch {
    return false
  }
}

export function findById<T extends { metadata: { id: string } }>(id: string, items: T[]): T | undefined {
  return items.find(i => i.metadata.id === id)
}

export async function getDefaultIds(
  bundleDir: string,
  defaultsDir: string,
  extension: string
): Promise<string[]> {
  try {
    const files = (await readdir(join(bundleDir, defaultsDir))).filter(f => f.endsWith(extension))
    return files.map(f => f.replace(extension, ''))
  } catch {
    return []
  }
}

export async function restoreDefault(
  itemDir: string,
  bundleDir: string,
  defaultsDir: string,
  id: string,
  extension: string
): Promise<boolean> {
  const filename = `${id}${extension}`
  const src = join(bundleDir, defaultsDir, filename)
  if (await dirExists(src)) {
    await copyFile(src, join(itemDir, filename))
    return true
  }
  return false
}