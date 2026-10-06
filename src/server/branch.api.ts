import type { Request, Response } from 'express'
import { resolve } from 'node:path'
import { logger } from './utils/logger.js'
import { getGitBranch } from './git/diff.js'

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
