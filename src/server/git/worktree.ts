import { spawn } from 'node:child_process'
import { mkdir, readFile, appendFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { logger } from '../utils/logger.js'

export function getGitBranch(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.on('close', (code) => resolve(code === 0 && out.trim() ? out.trim() : null))
    proc.on('error', () => resolve(null))
  })
}

export function listWorktrees(cwd: string): Promise<{ path: string; branch: string }[]> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['worktree', 'list', '--porcelain'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.on('close', (code) => {
      if (code !== 0) { resolve([]); return }
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
      resolve(entries)
    })
    proc.on('error', () => resolve([]))
  })
}

export function validateRef(cwd: string, name: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn('git', ['check-ref-format', `refs/heads/${name}`], { cwd, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(stderr.trim() || 'Invalid git branch name'))
    })
    proc.on('error', (err) => reject(err))
  })
}

export function addWorktree(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn('git', ['worktree', 'add', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(stderr.trim() || `git worktree add failed (code ${code})`))
    })
    proc.on('error', (err) => reject(err))
  })
}

const WORKTREES_GITIGNORE_PATTERN = /^worktrees[/\s]|^\/worktrees[/\s]/m

export async function ensureWorktreesIgnored(projectDir: string): Promise<void> {
  const gitignorePath = resolve(projectDir, '.gitignore')
  let content = ''
  try {
    content = await readFile(gitignorePath, 'utf-8')
  } catch {
    // File doesn't exist — will create it
  }
  if (WORKTREES_GITIGNORE_PATTERN.test(content)) return
  const entry = content.length > 0 && !content.endsWith('\n') ? '\nworktrees/\n' : 'worktrees/\n'
  await appendFile(gitignorePath, entry)
}

export interface WorktreeResult {
  path: string
  name: string
}

export async function ensureWorktree(projectDir: string, name: string, startBranch?: string): Promise<WorktreeResult> {
  const worktreesDir = resolve(projectDir, 'worktrees')
  const wtPath = resolve(worktreesDir, name.replace(/\//g, '-'))

  try {
    await mkdir(worktreesDir, { recursive: true })
  } catch (err) {
    logger.warn('Failed to create worktrees directory', { worktreesDir, error: String(err) })
  }

  try {
    await ensureWorktreesIgnored(projectDir)
  } catch (err) {
    logger.warn('Failed to update .gitignore', { projectDir, error: String(err) })
  }

  const startBranchResolved = startBranch ?? (await getGitBranch(projectDir)) ?? 'main'

  try {
    const st = await stat(wtPath)
    if (st.isDirectory()) return { path: wtPath, name }
  } catch {
    // Path doesn't exist — create the worktree
  }

  try {
    await addWorktree(projectDir, ['-b', name, wtPath, startBranchResolved])
  } catch {
    await addWorktree(projectDir, [wtPath, name]).catch((err) => {
      logger.warn('Worktree add failed', { name, error: String(err) })
      throw err
    })
  }

  return { path: wtPath, name }
}
