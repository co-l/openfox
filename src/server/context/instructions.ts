import { readFile, access, realpath } from 'node:fs/promises'
import { join, dirname, resolve, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { getSetting, SETTINGS_KEYS } from '../db/settings.js'
import { getProject } from '../db/projects.js'
import { CLAUDE_DIR, CLAUDE_MEMORY_FILENAME, resolveClaudeCompat } from '../shared/claude-compat.js'
import type { InjectedFile } from '../../shared/types.js'

// ============================================================================
// Types
// ============================================================================

export interface InstructionFile {
  path: string
  source: 'agents-md' | 'global' | 'project'
  content?: string
}

export interface LoadedInstructionFile extends InstructionFile {
  content: string
}

export interface AllInstructions {
  content: string
  files: InstructionFile[]
}

/** Overrides for discovery and loading; without them the settings decide. */
export interface InstructionOptions {
  claudeCompat?: boolean
  homeDir?: string
}

export function buildLanguageInstruction(language: string | null | undefined): string | null {
  const trimmed = language?.trim()
  if (!trimmed || trimmed.toLowerCase() === 'automatic') return null
  const display = trimmed[0]!.toUpperCase() + trimmed.slice(1)
  return `## LANGUAGE\n\nAlways respond to the user in ${display}.`
}

// Filenames to look for (in order of priority within same directory)
const INSTRUCTION_FILENAMES = ['AGENTS.md', 'CLAUDE.md']

/** `@path/to/file.md` — the `@` must open a word so emails never match. */
const IMPORT_PATTERN = /(^|[\s(])@([^\s@`'"()[\]]+)/g

/** Claude Code stops at five levels of nested imports. */
const MAX_IMPORT_DEPTH = 5

// ============================================================================
// Discovery
// ============================================================================

/**
 * Find instruction files by walking up the directory tree from workdir.
 * Returns files ordered from root to workdir (parent directories first),
 * so that files closer to the working directory can override parent instructions.
 *
 * With Claude Code compatibility on, `~/.claude/CLAUDE.md` (user memory) comes
 * first and each directory is also checked for `.claude/CLAUDE.md`.
 */
export async function findInstructionFiles(
  workdir: string,
  options: InstructionOptions = {},
): Promise<InstructionFile[]> {
  const compat = await resolveClaudeCompat(workdir, options.claudeCompat)
  const home = options.homeDir ?? homedir()
  const foundFiles: InstructionFile[] = []
  const seenPaths = new Set<string>()

  const addIfReadable = async (filePath: string): Promise<void> => {
    if (seenPaths.has(filePath)) return
    if (!(await fileExists(filePath))) return
    seenPaths.add(filePath)
    foundFiles.push({ path: filePath, source: 'agents-md' })
  }

  // User-level Claude Code memory applies before anything found on disk.
  if (compat) await addIfReadable(join(home, CLAUDE_DIR, CLAUDE_MEMORY_FILENAME))

  const pathsToCheck: string[] = []

  // Walk up the directory tree
  let currentDir = workdir
  while (true) {
    pathsToCheck.unshift(currentDir) // Add to front (we want root-first order)

    const parentDir = dirname(currentDir)
    // Stop if we've reached the root (dirname returns same path)
    if (parentDir === currentDir) {
      break
    }
    currentDir = parentDir
  }

  // Check each directory for instruction files
  for (const dir of pathsToCheck) {
    for (const filename of INSTRUCTION_FILENAMES) {
      await addIfReadable(join(dir, filename))
    }
    if (compat) await addIfReadable(join(dir, CLAUDE_DIR, CLAUDE_MEMORY_FILENAME))
  }

  return foundFiles
}

// ============================================================================
// Loading
// ============================================================================

/**
 * Read instruction files, expanding `@file` imports when compatibility is on
 * and dropping files whose content was already collected — repositories often
 * ship AGENTS.md and CLAUDE.md as copies (or symlinks) of one another.
 */
export async function loadInstructionFiles(
  files: InstructionFile[],
  options: InstructionOptions = {},
): Promise<LoadedInstructionFile[]> {
  const home = options.homeDir ?? homedir()
  const loaded: LoadedInstructionFile[] = []
  const seenContent = new Set<string>()
  // Callers pass the resolved flag; standalone calls fall back to the directory
  // of the innermost file, which is the one closest to the working directory.
  const deepest = files[files.length - 1]
  const compat = await resolveClaudeCompat(deepest ? dirname(deepest.path) : undefined, options.claudeCompat)

  for (const file of files) {
    const content = await readInstructionFile(file.path, compat, home)
    if (content === null) continue

    const normalized = content.trim()
    if (!normalized) continue

    const fingerprint = createHash('sha256').update(normalized).digest('hex')
    if (seenContent.has(fingerprint)) continue
    seenContent.add(fingerprint)

    loaded.push({ ...file, content })
  }

  return loaded
}

/**
 * Load instruction content from files.
 * Each file's content is prefixed with a comment showing its source path.
 */
export async function loadInstructions(files: InstructionFile[], options: InstructionOptions = {}): Promise<string> {
  return formatInstructions(await loadInstructionFiles(files, options))
}

function formatInstructions(files: LoadedInstructionFile[]): string {
  return files.map((file) => `Instructions from: ${file.path}\n${file.content}`).join('\n')
}

async function readInstructionFile(path: string, compat: boolean, home: string): Promise<string | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch {
    // File doesn't exist or can't be read - skip silently
    return null
  }
  if (!compat) return raw
  return expandImports(raw, dirname(path), home, new Set([await canonicalPath(path)]), 1)
}

// ============================================================================
// `@file` imports (Claude Code compatibility)
// ============================================================================

/**
 * Inline `@path` imports the way Claude Code does: paths resolve relative to
 * the importing file, `~/` expands to the home directory, and anything that
 * does not resolve to a readable file is left untouched.
 */
async function expandImports(
  content: string,
  baseDir: string,
  home: string,
  visited: Set<string>,
  depth: number,
): Promise<string> {
  if (depth > MAX_IMPORT_DEPTH || !content.includes('@')) return content

  const lines: string[] = []
  let inFence = false

  for (const line of content.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      lines.push(line)
      continue
    }
    if (inFence || !line.includes('@')) {
      lines.push(line)
      continue
    }
    lines.push(await expandLine(line, baseDir, home, visited, depth))
  }

  return lines.join('\n')
}

/** Backtick-delimited segments alternate; only even indexes sit outside code spans. */
async function expandLine(
  line: string,
  baseDir: string,
  home: string,
  visited: Set<string>,
  depth: number,
): Promise<string> {
  const segments = line.split('`')
  for (let i = 0; i < segments.length; i += 2) {
    segments[i] = await expandSegment(segments[i]!, baseDir, home, visited, depth)
  }
  return segments.join('`')
}

async function expandSegment(
  segment: string,
  baseDir: string,
  home: string,
  visited: Set<string>,
  depth: number,
): Promise<string> {
  const matches = [...segment.matchAll(IMPORT_PATTERN)]
  if (matches.length === 0) return segment

  let result = ''
  let cursor = 0

  for (const match of matches) {
    const start = match.index
    const prefix = match[1] ?? ''
    const rawPath = match[2] ?? ''
    const imported = await importFile(rawPath, baseDir, home, visited, depth)
    const replacement = imported ?? match[0].slice(prefix.length)
    result += segment.slice(cursor, start) + prefix + replacement
    cursor = start + match[0].length
  }

  return result + segment.slice(cursor)
}

/** Returns the imported text, `''` when already imported, or null when unresolvable. */
async function importFile(
  rawPath: string,
  baseDir: string,
  home: string,
  visited: Set<string>,
  depth: number,
): Promise<string | null> {
  const expanded = rawPath === '~' ? home : rawPath.startsWith('~/') ? join(home, rawPath.slice(2)) : rawPath
  const absolute = isAbsolute(expanded) ? expanded : resolve(baseDir, expanded)

  const key = await canonicalPath(absolute)
  // Already inlined somewhere in this file: drop the token instead of recursing.
  if (visited.has(key)) return ''

  let raw: string
  try {
    raw = await readFile(absolute, 'utf-8')
  } catch {
    return null
  }

  visited.add(key)
  const nested = await expandImports(raw, dirname(absolute), home, visited, depth + 1)
  return `\nInstructions from: ${absolute}\n${nested}\n`
}

// ============================================================================
// High-level helpers
// ============================================================================

/**
 * Convenience function to find and load all instruction files for a workdir.
 * Only includes AGENTS.md files, not global or project instructions.
 */
export async function getInstructionsForWorkdir(
  workdir: string,
  options: InstructionOptions = {},
): Promise<{
  content: string
  files: InstructionFile[]
}> {
  const resolved = { ...options, claudeCompat: await resolveClaudeCompat(workdir, options.claudeCompat) }
  const files = await findInstructionFiles(workdir, resolved)
  const content = await loadInstructions(files, resolved)
  return { content, files }
}

/**
 * Load ALL instructions from all sources for a session.
 * Order: language → global → project → AGENTS.md files
 * This is the primary function that should be used when building prompts.
 */
export async function getAllInstructions(
  workdir: string,
  projectId: string,
  options: InstructionOptions = {},
): Promise<AllInstructions> {
  const sections: string[] = []
  const allFiles: InstructionFile[] = []

  // 0. Language (from settings) - always first when set
  const languageInstruction = buildLanguageInstruction(getSetting(SETTINGS_KEYS.LANGUAGE))
  if (languageInstruction) {
    sections.push(languageInstruction)
  }

  // 1. Global instructions (from settings)
  const globalInstructions = getSetting(SETTINGS_KEYS.GLOBAL_INSTRUCTIONS)
  if (globalInstructions) {
    sections.push(`## GLOBAL INSTRUCTIONS\n\n${globalInstructions}`)
    allFiles.push({ path: 'Global Instructions', source: 'global', content: globalInstructions })
  }

  // 2. Project instructions (from project record)
  const project = getProject(projectId)
  if (project?.customInstructions) {
    sections.push(`## PROJECT INSTRUCTIONS\n\n${project.customInstructions}`)
    allFiles.push({ path: `Project: ${project.name}`, source: 'project', content: project.customInstructions })
  }

  // 3. AGENTS.md / CLAUDE.md files (from filesystem)
  const resolved = { ...options, claudeCompat: await resolveClaudeCompat(workdir, options.claudeCompat) }
  const agentFiles = await findInstructionFiles(workdir, resolved)
  if (agentFiles.length > 0) {
    const loaded = await loadInstructionFiles(agentFiles, resolved)
    if (loaded.length > 0) {
      sections.push(`## FILE INSTRUCTIONS\n\n${formatInstructions(loaded)}`)
      allFiles.push(...loaded)
    }
  }

  return {
    content: sections.join('\n\n'),
    files: allFiles,
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

/** Resolves symlinks so the same file reached through two paths counts once. */
async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

export function toInjectedFiles(files: InstructionFile[]): InjectedFile[] {
  return files.map((file) => ({
    path: file.path,
    content: file.content ?? '',
    source: file.source,
  }))
}
