import { access, constants } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPathSeparator, isAbsolutePath } from './platform.js'

// Get the directory where this module is located
// In dev: src/server/utils/
// In prod: dist/server/utils/
const __dirname = dirname(fileURLToPath(import.meta.url))

// Path to bundled node_modules/.bin
// Uses process.cwd() as the primary source (where user runs the command)
// Falls back to relative paths from this module location
function getBundledBinPaths(): string[] {
  const paths: string[] = []
  
  // Primary: use current working directory (where user runs openfox)
  paths.push(join(process.cwd(), 'node_modules', '.bin'))
  
  // Fallback: relative to this module (for edge cases)
  paths.push(join(__dirname, '..', '..', '..', 'node_modules', '.bin'))
  paths.push(join(__dirname, '..', '..', '..', '..', 'node_modules', '.bin'))
  
  return paths
}

/**
 * Check if a command exists at a given path
 */
async function existsExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Find the path to an executable command.
 * Search order:
 * 1. Bundled language servers in @openfox/server's node_modules/.bin
 * 2. Project-local node_modules/.bin (if workdir provided)
 * 3. System PATH
 * 
 * Returns null if the command is not found.
 */
export async function which(command: string, workdir?: string): Promise<string | null> {
  if (isAbsolutePath(command)) {
    if (await existsExecutable(command)) {
      return command
    }
    return null
  }
  
  // 1. Check bundled node_modules/.bin first (language servers bundled with @openfox/server)
  for (const binDir of getBundledBinPaths()) {
    const fullPath = join(binDir, command)
    if (await existsExecutable(fullPath)) {
      return fullPath
    }
  }
  
  // 2. Check project-local node_modules/.bin (if workdir provided)
  if (workdir) {
    const projectBin = join(workdir, 'node_modules', '.bin', command)
    if (await existsExecutable(projectBin)) {
      return projectBin
    }
  }
  
  // 3. Search system PATH
  const pathEnv = process.env['PATH'] ?? ''
  const paths = pathEnv.split(getPathSeparator())
  
  for (const dir of paths) {
    if (!dir) continue
    
    const fullPath = join(dir, command)
    if (await existsExecutable(fullPath)) {
      return fullPath
    }
  }
  
  return null
}
