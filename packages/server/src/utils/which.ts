import { access, constants } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Get the directory where this module is located
// In dev: packages/server/src/utils/
// In prod: wherever @openfox/server is installed
const __dirname = dirname(fileURLToPath(import.meta.url))

// Path to bundled node_modules/.bin (relative to this file)
// In dev: packages/server/node_modules/.bin
// In prod: node_modules/@openfox/server/node_modules/.bin or node_modules/.bin
function getBundledBinPaths(): string[] {
  const paths: string[] = []
  
  // Go up from src/utils to package root, then to node_modules/.bin
  // Works for: packages/server/src/utils -> packages/server/node_modules/.bin
  paths.push(join(__dirname, '..', '..', 'node_modules', '.bin'))
  
  // Also check monorepo root node_modules/.bin (hoisted deps)
  // Works for: packages/server/src/utils -> node_modules/.bin
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
  // If it's an absolute path, check if it exists and is executable
  if (command.startsWith('/')) {
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
  const paths = pathEnv.split(':')
  
  for (const dir of paths) {
    if (!dir) continue
    
    const fullPath = join(dir, command)
    if (await existsExecutable(fullPath)) {
      return fullPath
    }
  }
  
  return null
}
