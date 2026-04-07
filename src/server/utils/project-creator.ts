import { mkdir } from 'node:fs/promises'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { createProject as createProjectDb } from '../db/projects.js'
import type { Project } from '../../shared/types.js'

/**
 * Validate a project name for safe directory creation.
 * Allows alphanumeric characters, hyphens, underscores, dots, and spaces.
 */
export function validateProjectName(name: string): { valid: true } | { valid: false; error: string } {
  if (!name || name.trim() === '') {
    return { valid: false, error: 'Project name cannot be empty' }
  }
  
  // Check for valid characters (alphanumeric, hyphens, underscores, dots, spaces)
  const validPattern = /^[a-zA-Z0-9._ -]+$/
  if (!validPattern.test(name)) {
    return { 
      valid: false, 
      error: 'Project name can only contain letters, numbers, hyphens, underscores, dots, and spaces' 
    }
  }
  
  // Check for path traversal attempts
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    return { valid: false, error: 'Project name cannot contain path separators' }
  }
  
  return { valid: true }
}

/**
 * Check if a directory already exists at the given path
 */
export async function directoryExists(path: string): Promise<boolean> {
  try {
    const { access } = await import('node:fs/promises')
    const { constants } = await import('node:fs')
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Create a new project directory with git initialization.
 * 
 * @param projectName - The name of the project (will be prefixed with workdir)
 * @param workdir - The base directory where the project will be created
 * @returns The created project
 * @throws Error if creation fails
 */
export async function createDirectoryWithGit(projectName: string, workdir: string): Promise<Project> {
  // Validate project name
  const validation = validateProjectName(projectName)
  if (!validation.valid) {
    throw new Error(validation.error)
  }
  
  // Build full path - sanitize name for filesystem (replace spaces with hyphens)
  const sanitizedName = projectName.trim().replace(/\s+/g, '-')
  const fullPath = join(workdir, sanitizedName)
  
  // Check if directory already exists
  const exists = await directoryExists(fullPath)
  if (exists) {
    throw new Error(`Directory already exists: ${fullPath}. Please choose a different name or use the existing directory from Browse Projects.`)
  }
  
  // Create directory recursively
  try {
    await mkdir(fullPath, { recursive: true })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`Failed to create directory: ${errorMessage}`)
  }
  
  // Initialize git repository
  try {
    execSync('git init', { cwd: fullPath, stdio: 'pipe' })
  } catch (error) {
    // Clean up the directory if git init fails
    const { rm } = await import('node:fs/promises')
    await rm(fullPath, { recursive: true, force: true })
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`Failed to initialize git repository: ${errorMessage}`)
  }
  
  // Register project in database with base workdir (not full path)
  const project = createProjectDb(projectName, workdir)
  
  return project
}
