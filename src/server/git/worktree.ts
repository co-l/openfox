import { spawn } from 'node:child_process'
import { mkdir, readFile, appendFile, stat, symlink, cp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { logger } from '../utils/logger.js'
import { gitSpawnEnv } from './env.js'
import type { WorktreeConfig } from '../../shared/worktree.js'

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

function runGit(cwd: string, args: string[]): Promise<void> {
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

export function getGitBranch(cwd: string): Promise<string | null> {
  return captureStdout(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).then((r) => r?.trim() ?? null)
}

export function listWorktrees(cwd: string): Promise<{ path: string; branch: string }[]> {
  return captureStdout(cwd, ['worktree', 'list', '--porcelain']).then((out) => {
    if (!out) return []
    const entries: { path: string; branch: string }[] = []
    let current: { path?: string; branch?: string } = {}
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ')) current.path = line.slice(9)
      else if (line.startsWith('branch ')) current.branch = line.slice(7).replace('refs/heads/', '')
      else if (line === '' && current.path && current.branch) {
        entries.push({ path: current.path, branch: current.branch })
        current = {}
      }
    }
    if (current.path && current.branch) entries.push({ path: current.path, branch: current.branch })
    return entries
  })
}

export function validateRef(cwd: string, name: string): Promise<void> {
  return runGit(cwd, ['check-ref-format', `refs/heads/${name}`])
}

export function addWorktree(cwd: string, args: string[]): Promise<void> {
  return runGit(cwd, ['worktree', 'add', ...args])
}

export async function ensureWorktreesIgnored(projectDir: string): Promise<void> {
  const gitignorePath = resolve(projectDir, '.gitignore')
  let content = ''
  try {
    content = await readFile(gitignorePath, 'utf-8')
  } catch {
    // File doesn't exist — will create it
  }
  const lines = content.split('\n')
  const hasWorktreesIgnore = lines.some(
    (line) => line.trim() === 'worktrees/' || line.trim() === '/worktrees/' || line.trim() === 'worktrees',
  )
  if (hasWorktreesIgnore) return
  const entry = content.length > 0 && !content.endsWith('\n') ? '\nworktrees/\n' : 'worktrees/\n'
  await appendFile(gitignorePath, entry)
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

export function checkoutBranch(cwd: string, name: string): Promise<void> {
  return runGit(cwd, ['checkout', name])
}

export function createBranch(cwd: string, name: string): Promise<void> {
  return runGit(cwd, ['checkout', '-b', name])
}

export interface WorktreeResult {
  path: string
  name: string
}

function branchExists(cwd: string, name: string): Promise<boolean> {
  return captureStdout(cwd, ['rev-parse', '--verify', `refs/heads/${name}`]).then((r) => r !== null)
}

export async function ensureWorktree(projectDir: string, name: string, startBranch?: string): Promise<WorktreeResult> {
  await validateRef(projectDir, name)

  const worktreesDir = resolve(projectDir, 'worktrees')
  const wtPath = resolve(worktreesDir, name.replace(/\//g, '-'))

  await mkdir(worktreesDir, { recursive: true })

  await ensureWorktreesIgnored(projectDir).catch((err) => {
    logger.warn('Failed to update .gitignore', { projectDir, error: String(err) })
  })

  const startBranchResolved = startBranch ?? (await getGitBranch(projectDir)) ?? 'main'

  try {
    const st = await stat(wtPath)
    if (st.isDirectory()) return { path: wtPath, name }
  } catch {
    // Path doesn't exist — create the worktree
  }

  try {
    await addWorktree(projectDir, ['-b', name, wtPath, startBranchResolved])
  } catch (err) {
    const exists = await branchExists(projectDir, name)
    if (exists) {
      await addWorktree(projectDir, [wtPath, name])
    } else {
      throw err
    }
  }

  return { path: wtPath, name }
}

export async function getIgnoredDirectories(projectDir: string): Promise<string[]> {
  const out = await captureStdout(projectDir, [
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    '--directory',
  ])
  if (!out) return []
  return out.trim().split('\n').filter(Boolean)
}

function resolveStrategy(relPath: string, config: WorktreeConfig): 'symlink' | 'copy' | 'skip' {
  const basename = relPath.split('/').pop() ?? relPath
  return config.overrides?.[relPath] ?? config.overrides?.[basename] ?? config.ignoredAssets
}

export async function syncIgnoredAssets(
  projectDir: string,
  worktreePath: string,
  config: WorktreeConfig,
): Promise<void> {
  const ignoredPaths = await getIgnoredDirectories(projectDir)
  if (ignoredPaths.length === 0) return

  const results: string[] = []

  for (const relPath of ignoredPaths) {
    const sourcePath = resolve(projectDir, relPath)
    const targetPath = resolve(worktreePath, relPath)

    try {
      await stat(sourcePath)
    } catch {
      continue
    }

    const strategy = resolveStrategy(relPath, config)
    if (strategy === 'skip') continue

    try {
      if (strategy === 'symlink') {
        try {
          await stat(targetPath)
          continue
        } catch {
          // target doesn't exist — proceed
        }
        await symlink(sourcePath, targetPath)
        results.push(`symlink ${relPath}`)
      } else if (strategy === 'copy') {
        await cp(sourcePath, targetPath, { recursive: true, force: true })
        results.push(`copy ${relPath}`)
      }
    } catch (err) {
      logger.warn('Failed to sync ignored asset to worktree', { relPath, strategy, error: String(err) })
    }
  }

  if (results.length > 0) {
    logger.info('Synced ignored assets to worktree', { count: results.length, actions: results })
  }
}
