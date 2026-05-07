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
  const { stat, mkdir, rm, access, constants } = await import('node:fs/promises')

  const dirAlreadyExisted = await access(fullPath, constants.F_OK)
    .then(() => true)
    .catch(() => false)

  try {
    const stats = await stat(fullPath)
    if (!stats.isDirectory()) {
      throw new Error(`A file named '${projectName}' already exists at ${fullPath}`)
    }
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      try {
        await mkdir(fullPath, { recursive: true })
      } catch (mkdirErr) {
        if (mkdirErr instanceof Error && 'code' in mkdirErr && mkdirErr.code === 'EACCES') {
          const eaccError = mkdirErr as NodeJS.ErrnoException
          const permError = new Error(`Permission denied: cannot create directory at ${fullPath}`, {
            cause: eaccError,
          }) as Error & { code?: string }
          permError.code = 'EACCES'
          throw permError
        }
        throw mkdirErr
      }
    } else if (err instanceof Error && 'code' in err && err.code === 'EACCES') {
      const eaccError = err as NodeJS.ErrnoException
      const permError = new Error(`Permission denied: cannot access directory at ${fullPath}`, {
        cause: eaccError,
      }) as Error & { code?: string }
      permError.code = 'EACCES'
      throw permError
    } else {
      throw err
    }
  }

  if (!(await directoryExists(join(fullPath, '.git')))) {
    try {
      execSync('git init', { cwd: fullPath, stdio: 'pipe' })
    } catch (gitErr) {
      const errMsg = gitErr instanceof Error ? gitErr.message : 'Unknown'
      const exitCode = (gitErr as { status?: number }).status ?? (gitErr as { exitCode?: number }).exitCode
      const isPermission = errMsg.includes('Permission denied') || exitCode === 128

      // Try via sudo -u $USER if permission denied (process may not have correct groups)
      let sudoSuccess = false
      if (isPermission) {
        try {
          const currentUser = execSync('id -un', { encoding: 'utf-8' }).trim()
          execSync(`sudo -u ${currentUser} git init`, { cwd: fullPath, stdio: 'pipe' })
          sudoSuccess = true
        } catch {
          // sudo also failed, fall through to error
        }
      }

      if (!sudoSuccess) {
        const permError = new Error(`Failed to initialize git: ${errMsg}`) as Error & { code?: string }
        if (isPermission) {
          permError.code = 'EACCES'
        }
        // Only clean up if we created this directory ourselves
        if (!dirAlreadyExisted) {
          try {
            await rm(fullPath, { recursive: true, force: true })
          } catch {
            // ignore cleanup errors
          }
        }
        throw permError
      }
    }
  }

  return createProjectDb(projectName, fullPath)
}
