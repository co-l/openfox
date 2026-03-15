import { readFile, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { constants } from 'node:fs'
import { getSetting, SETTINGS_KEYS } from '../db/settings.js'
import { getProject } from '../db/projects.js'

// ============================================================================
// Types
// ============================================================================

export interface InstructionFile {
  path: string
  source: 'agents-md' | 'global' | 'project'
  content?: string
}

export interface AllInstructions {
  content: string
  files: InstructionFile[]
}

// Filenames to look for (in order of priority within same directory)
const INSTRUCTION_FILENAMES = ['AGENTS.md', 'CLAUDE.md']

// ============================================================================
// Discovery
// ============================================================================

/**
 * Find instruction files by walking up the directory tree from workdir.
 * Returns files ordered from root to workdir (parent directories first),
 * so that files closer to the working directory can override parent instructions.
 */
export async function findInstructionFiles(workdir: string): Promise<InstructionFile[]> {
  const foundFiles: InstructionFile[] = []
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
      const filePath = join(dir, filename)
      if (await fileExists(filePath)) {
        foundFiles.push({
          path: filePath,
          source: 'agents-md',
        })
      }
    }
  }
  
  return foundFiles
}

/**
 * Load instruction content from files.
 * Each file's content is prefixed with a comment showing its source path.
 */
export async function loadInstructions(files: InstructionFile[]): Promise<string> {
  const contents: string[] = []
  
  for (const file of files) {
    try {
      const content = await readFile(file.path, 'utf-8')
      contents.push(`Instructions from: ${file.path}\n${content}`)
    } catch {
      // File doesn't exist or can't be read - skip silently
      continue
    }
  }
  
  return contents.join('\n')
}

/**
 * Convenience function to find and load all instruction files for a workdir.
 * Only includes AGENTS.md files, not global or project instructions.
 */
export async function getInstructionsForWorkdir(workdir: string): Promise<{
  content: string
  files: InstructionFile[]
}> {
  const files = await findInstructionFiles(workdir)
  const content = await loadInstructions(files)
  return { content, files }
}

/**
 * Load ALL instructions from all sources for a session.
 * Order: global → project → AGENTS.md files
 * This is the primary function that should be used when building prompts.
 */
export async function getAllInstructions(
  workdir: string,
  projectId: string
): Promise<AllInstructions> {
  const sections: string[] = []
  const allFiles: InstructionFile[] = []
  
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
  
  // 3. AGENTS.md files (from filesystem)
  const agentFiles = await findInstructionFiles(workdir)
  if (agentFiles.length > 0) {
    const agentContent = await loadInstructions(agentFiles)
    if (agentContent) {
      sections.push(`## FILE INSTRUCTIONS\n\n${agentContent}`)
      // Load content for each file
      for (const file of agentFiles) {
        try {
          const content = await readFile(file.path, 'utf-8')
          allFiles.push({ ...file, content })
        } catch {
          allFiles.push(file)
        }
      }
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
