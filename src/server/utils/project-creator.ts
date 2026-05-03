import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { createProject as createProjectDb } from '../db/projects.js'
import type { Project } from '../../shared/types.js'

export function validateProjectName(name: string): { valid: true } | { valid: false; error: string } {
  if (!name || name.trim() === '') {
    return { valid: false, error: 'Project name cannot be empty' }
  }
  if (!/^[a-zA-Z0-9._ -]+$/.test(name)) {
    return {
      valid: false,
      error: 'Project name can only contain letters, numbers, hyphens, underscores, dots, and spaces',
    }
  }
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    return { valid: false, error: 'Project name cannot contain path separators' }
  }
  return { valid: true }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const { access } = await import('node:fs/promises')
    const { constants } = await import('node:fs')
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function createDirectoryWithGit(projectName: string, workdir: string): Promise<Project> {
  const validation = validateProjectName(projectName)
  if (!validation.valid) {
    throw new Error(validation.error)
  }

  const fullPath = workdir.replace(/\/+$/, '')
  const { stat, mkdir } = await import('node:fs/promises')

  try {
    const stats = await stat(fullPath)
    if (!stats.isDirectory()) {
      throw new Error(`A file named '${projectName}' already exists at ${fullPath}`)
    }
  } catch {
    await mkdir(fullPath, { recursive: true })
  }

  if (!(await directoryExists(join(fullPath, '.git')))) {
    try {
      execSync('git init', { cwd: fullPath, stdio: 'pipe' })
    } catch (gitErr) {
      const { rm } = await import('node:fs/promises')
      await rm(fullPath, { recursive: true, force: true })
      throw new Error(`Failed to initialize git: ${gitErr instanceof Error ? gitErr.message : 'Unknown'}`)
    }
  }

  return createProjectDb(projectName, fullPath)
}
