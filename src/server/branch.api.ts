import type { Request, Response } from 'express'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { logger } from './utils/logger.js'

/**
 * GET /api/branch
 * Get the current git branch name for a workdir
 */
export async function getCurrentBranch(req: Request, res: Response): Promise<void> {
  try {
    const workdir = (req.query['workdir'] as string) || process.cwd()
    const resolvedWorkdir = resolve(workdir)

    const branch = await getGitBranch(resolvedWorkdir)

    if (branch) {
      res.json({ branch, workdir: resolvedWorkdir })
    } else {
      res.json({ branch: null, workdir: resolvedWorkdir, error: 'Not a git repository' })
    }
  } catch (error) {
    logger.error('Error getting current branch', { error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({ error: 'Failed to get branch', branch: null })
  }
}

/**
 * Execute git rev-parse --abbrev-ref HEAD to get the current branch name
 */
function getGitBranch(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    let stdout = ''

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim())
      } else {
        resolve(null)
      }
    })

    proc.on('error', () => {
      resolve(null)
    })
  })
}
