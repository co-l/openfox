import { spawn, execSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { resolve, join, isAbsolute } from 'node:path'
import { homedir, platform } from 'node:os'
import { logger } from '../utils/logger.js'
import { gitSpawnEnv } from './env.js'
import { loadWorkspaceConfig } from './workspace-config.js'

function captureStdout(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const proc = spawn('git', args, { cwd, env: gitSpawnEnv(), stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    proc.stdout.on('data', (d: Buffer) => {
      out += d.toString()
    })
    proc.on('close', (code) => resolvePromise(code === 0 ? out : null))
    proc.on('error', () => resolvePromise(null))
  })
}

export function runGit(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn('git', args, { cwd, env: gitSpawnEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    proc.on('close', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(stderr.trim() || `git ${args[0]} failed (code ${code})`))
    })
    proc.on('error', (err) => reject(err))
  })
}

function getServerMode(): 'development' | 'production' {
  return process.env['OPENFOX_DEV'] === 'true' ? 'development' : 'production'
}

function getGlobalDataDir(): string {
  const mode = getServerMode()
  const suffix = mode === 'development' ? '-dev' : ''
  const home = homedir()
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', `openfox${suffix}`)
    case 'win32':
      return join(process.env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local'), `openfox${suffix}`)
    default:
      return join(process.env['XDG_DATA_HOME'] ?? join(home, '.local', 'share'), `openfox${suffix}`)
  }
}

export function getWorkspacesDir(projectName: string): string {
  return join(getGlobalDataDir(), 'workspaces', projectName)
}

export function getGitBranch(cwd: string): Promise<string | null> {
  return captureStdout(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).then((r) => r?.trim() ?? null)
}

export interface BranchInfo {
  name: string
  current: boolean
}

export function listBranches(cwd: string): Promise<BranchInfo[]> {
  return captureStdout(cwd, ['branch', '--format', '%(refname:short)%09%(HEAD)']).then((out) => {
    if (!out) return []
    const branches: BranchInfo[] = []
    for (const line of out.trim().split('\n')) {
      if (!line) continue
      const [name, head] = line.split('\t')
      if (name) branches.push({ name, current: head === '*' })
    }
    return branches
  })
}

export function listRemoteBranches(cwd: string): Promise<string[]> {
  return captureStdout(cwd, ['branch', '-r', '--format', '%(refname:short)']).then((out) => {
    if (!out) return []
    return out
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((b) => b.trim())
  })
}

/**
 * Count how many commits the workspace's current branch is behind the same
 * branch on origin (the original repo). Returns 0 if up to date, null if the
 * branch doesn't exist on origin or the comparison fails.
 */
export async function getCommitsBehind(cwd: string, branch: string): Promise<number | null> {
  const out = await captureStdout(cwd, ['rev-list', '--count', 'HEAD..origin/' + branch, '--'])
  if (out === null) return null
  const count = parseInt(out.trim(), 10)
  return Number.isNaN(count) ? null : count
}

export function validateRef(cwd: string, name: string): Promise<void> {
  return runGit(cwd, ['check-ref-format', `refs/heads/${name}`])
}

/**
 * Resolve the default branch for a project directory.
 * Fetches origin to ensure remote refs are up to date, then reads origin/HEAD.
 * Falls back to the current branch, then 'main'.
 */
export async function getDefaultBranch(projectDir: string): Promise<string> {
  await runGit(projectDir, ['fetch', 'origin', '--no-tags', '--quiet']).catch(() => {})
  const originHead = await captureStdout(projectDir, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
  if (originHead) {
    const branch = originHead.trim().replace('refs/remotes/origin/', '')
    if (branch) return branch
  }
  const current = await getGitBranch(projectDir)
  if (current) return current
  return 'main'
}

/**
 * Resolve and validate a source branch name for creating a new branch.
 * Ensures the branch exists locally or on the remote, creating a tracking ref if needed.
 * Returns the local ref name that can be used as the source for git checkout -b.
 * @param projectDir - optional project root directory (for upstream remote resolution)
 */
export async function resolveAndValidateSourceBranch(
  cwd: string,
  sourceBranch: string,
  projectDir?: string,
): Promise<string> {
  // Validate the source branch name format first
  await validateRef(cwd, sourceBranch.replace(/^origin\//, ''))

  // fetch to ensure remote refs are up to date
  await runGit(cwd, ['fetch', 'origin', '--no-tags', '--quiet']).catch(() => {})

  // strip optional origin/ prefix to get the branch name
  const branchName = sourceBranch.replace(/^origin\//, '')

  // check if it exists locally
  const localRef = await captureStdout(cwd, ['rev-parse', '--verify', '--quiet', 'refs/heads/' + branchName])
  if (localRef !== null) return branchName

  // check if it exists on workspace origin
  const remoteRef = await captureStdout(cwd, ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/' + branchName])
  if (remoteRef !== null) {
    // create a local tracking branch from origin without switching cwd's checkout
    await runGit(cwd, ['branch', '--track', branchName, 'origin/' + branchName])
    return branchName
  }

  // check on the project's upstream origin (workspace origin is local with --shared clone)
  if (projectDir) {
    const remoteExists = await captureStdout(projectDir, ['ls-remote', '--heads', 'origin', branchName])
    if (remoteExists !== null && remoteExists.trim() !== '') {
      // Fetch the branch from the project's upstream via its remote-tracking ref
      // In --shared clones, the project dir has the branch as refs/remotes/origin/..., not refs/heads/...
      await runGit(cwd, ['fetch', projectDir, 'refs/remotes/origin/' + branchName + ':refs/heads/' + branchName]).catch(
        async () => {
          // fallback: fetch from upstream then create branch
          await runGit(projectDir, ['fetch', 'origin', branchName])
          await runGit(cwd, ['fetch', projectDir, 'refs/remotes/origin/' + branchName + ':refs/heads/' + branchName])
        },
      )
      return branchName
    }
  }

  throw new Error(
    `Source branch "${sourceBranch}" not found locally or on origin. Use a valid branch name like "main" or "origin/main".`,
  )
}

export function validateWorkspaceName(name: string): void {
  if (!name || typeof name !== 'string') throw new Error('Workspace name is required')
  if (name.includes('/') || name.includes('\\')) throw new Error('Workspace name cannot contain path separators')
  if (name === '.' || name === '..') throw new Error('Workspace name cannot be "." or ".."')
  if (isAbsolute(name)) throw new Error('Workspace name cannot be an absolute path')
  if (name.length > 255) throw new Error('Workspace name is too long')
}

export function checkoutBranch(cwd: string, name: string): Promise<void> {
  return runGit(cwd, ['checkout', name])
}

export function createBranch(cwd: string, name: string, sourceBranch?: string): Promise<void> {
  const args = sourceBranch ? ['checkout', '-b', name, sourceBranch] : ['checkout', '-b', name]
  return runGit(cwd, args)
}

export interface WorkspaceInfo {
  path: string
  name: string
  branch: string | null
}

export async function workspaceExists(projectName: string, name: string): Promise<boolean> {
  const dir = getWorkspacesDir(projectName)
  const wsPath = resolve(dir, name)
  const st = await statSafe(wsPath)
  if (!st?.isDirectory()) return false
  const gitDir = join(wsPath, '.git')
  const gitSt = await statSafe(gitDir)
  return gitSt?.isDirectory() ?? false
}

export async function listWorkspaces(projectName: string): Promise<WorkspaceInfo[]> {
  const dir = getWorkspacesDir(projectName)
  try {
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(dir, { withFileTypes: true })
    const workspaces: WorkspaceInfo[] = []
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const wsPath = resolve(dir, entry.name)
        const branch = await getGitBranch(wsPath)
        workspaces.push({ path: wsPath, name: entry.name, branch })
      }
    }
    return workspaces.sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

export interface WorkspaceResult {
  path: string
  name: string
}

export async function ensureWorkspace(
  projectDir: string,
  name: string,
  projectName: string,
  branch?: string,
  sourceBranch?: string,
): Promise<WorkspaceResult> {
  const workspacesDir = getWorkspacesDir(projectName)
  const wsPath = resolve(workspacesDir, name)

  await mkdir(workspacesDir, { recursive: true })

  const existing = await statSafe(wsPath)
  if (existing?.isDirectory()) {
    const gitDir = join(wsPath, '.git')
    const gitStat = await statSafe(gitDir)
    if (!gitStat?.isDirectory()) {
      throw new Error('Existing path is not a valid workspace: ' + wsPath)
    }
    logger.info('Workspace directory already exists, reusing', { path: wsPath })
  } else {
    await runGit(projectDir, ['clone', '--shared', projectDir, wsPath])
  }

  const st = await statSafe(wsPath)
  if (!st?.isDirectory()) {
    throw new Error('Failed to clone workspace')
  }

  // If a specific branch was requested, check it out
  if (branch) {
    await validateRef(wsPath, branch)
    await runGit(wsPath, ['checkout', branch]).catch(async () => {
      const sb = sourceBranch
        ? await resolveAndValidateSourceBranch(wsPath, sourceBranch, projectDir)
        : await getDefaultBranch(projectDir)
      await runGit(wsPath, ['checkout', '-b', branch, sb])
    })
  }

  const config = await loadWorkspaceConfig(projectDir)
  if (config?.setup && config.setup.length > 0) {
    for (const cmd of config.setup) {
      logger.info('Running workspace setup command', { command: cmd, cwd: wsPath })
      try {
        execSync(cmd, { cwd: wsPath, stdio: 'inherit', env: { ...process.env } })
      } catch (err) {
        logger.warn('Workspace setup command failed', { command: cmd, error: String(err) })
      }
    }
  }

  return { path: wsPath, name }
}

export async function deleteWorkspace(projectName: string, name: string): Promise<void> {
  const dir = getWorkspacesDir(projectName)
  const wsPath = resolve(dir, name)
  const st = await statSafe(wsPath)
  if (!st?.isDirectory()) {
    throw new Error(`Workspace "${name}" does not exist`)
  }
  const { rm } = await import('node:fs/promises')
  await rm(wsPath, { recursive: true, force: true })
  logger.info('Deleted workspace', { projectName, name, path: wsPath })
}

async function statSafe(p: string): Promise<{ isDirectory: () => boolean } | null> {
  try {
    const { stat } = await import('node:fs/promises')
    return await stat(p)
  } catch {
    return null
  }
}
