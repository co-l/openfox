import { spawn } from 'node:child_process'
import type { GitDiffFile } from '../../shared/protocol.js'

export function getGitDiffFiles(cwd: string): Promise<GitDiffFile[]> {
  return new Promise((resolve) => {
    const diffProc = spawn('git', ['diff', '--name-status', 'HEAD'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const statusProc = spawn('git', ['status', '--porcelain'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let diffStdout = ''
    let statusStdout = ''
    let diffExited = false
    let statusExited = false
    let diffCode: number | null = null
    let statusCode: number | null = null

    const collect = () => {
      if (!diffExited || !statusExited) return

      const files: GitDiffFile[] = []

      if (diffCode === 0) {
        for (const line of diffStdout.split('\n')) {
          if (!line.trim()) continue
          const [statusChar, ...pathParts] = line.split('\t')
          const path = pathParts.join('\t') || statusChar || ''
          if (!path) continue
          const status = statusChar === 'A' ? 'added' : statusChar === 'D' ? 'deleted' : 'modified'
          files.push({ path, status, additions: 0, deletions: 0 })
        }
      }

      if (statusCode === 0) {
        for (const line of statusStdout.split('\n')) {
          if (!line.startsWith('?? ')) continue
          const path = line.slice(3).trim()
          if (!path) continue
          files.push({ path, status: 'added', additions: 0, deletions: 0 })
        }
      }

      resolve(files)
    }

    diffProc.stdout.on('data', (data: Buffer) => {
      diffStdout += data.toString()
    })
    statusProc.stdout.on('data', (data: Buffer) => {
      statusStdout += data.toString()
    })

    diffProc.on('close', (code) => {
      diffExited = true
      diffCode = code
      collect()
    })
    statusProc.on('close', (code) => {
      statusExited = true
      statusCode = code
      collect()
    })
    diffProc.on('error', () => {
      diffExited = true
      diffCode = 1
      collect()
    })
    statusProc.on('error', () => {
      statusExited = true
      statusCode = 1
      collect()
    })
  })
}

export async function formatGitDiffFiles(cwd: string): Promise<string> {
  const files = await getGitDiffFiles(cwd)
  if (files.length === 0) return '(none)'
  return files.map((f) => `- ${f.path} (${f.status})`).join('\n')
}
