/**
 * Shell command execution for workflow shell steps.
 */

import { checkAborted, spawnShellProcess } from '../utils/shell.js'

export interface ShellResult {
  exitCode: number
  stdout: string
  stderr: string
  success: boolean
}

/**
 * Execute a shell command with timeout and abort support.
 * Returns the exit code, stdout, and stderr.
 */
export function executeShellCommand(
  command: string,
  cwd: string,
  timeout: number,
  signal?: AbortSignal,
): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    if (checkAborted(signal)) {
      reject(new Error('Aborted'))
      return
    }

    const proc = spawnShellProcess(command, cwd, signal)
    let stdout = ''
    let stderr = ''
    let killed = false

    const timer = setTimeout(() => {
      killed = true
      proc.kill('SIGTERM')
      resolve({ exitCode: 1, stdout, stderr: stderr + '\nCommand timed out', success: false })
    }, timeout)

    const onAbort = () => {
      if (!killed) {
        killed = true
        proc.kill('SIGTERM')
        clearTimeout(timer)
        reject(new Error('Aborted'))
      }
    }
    signal?.addEventListener('abort', onAbort)

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (killed) return
      const exitCode = code ?? 1
      resolve({ exitCode, stdout, stderr, success: exitCode === 0 })
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (killed) return
      resolve({ exitCode: 1, stdout, stderr: err.message, success: false })
    })
  })
}
