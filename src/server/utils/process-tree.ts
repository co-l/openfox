import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const SIGKILL_TIMEOUT_MS = 200

export async function terminateProcessTree(
  proc: ChildProcess,
  options?: { exited?: () => boolean }
): Promise<void> {
  const pid = proc.pid
  if (!pid || options?.exited?.()) {
    return
  }

  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/f', '/t'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      killer.once('exit', () => resolve())
      killer.once('error', () => resolve())
    })
    return
  }

  try {
    process.kill(-pid, 'SIGTERM')
    await sleep(SIGKILL_TIMEOUT_MS)
    if (!options?.exited?.()) {
      process.kill(-pid, 'SIGKILL')
    }
  } catch {
    proc.kill('SIGTERM')
    await sleep(SIGKILL_TIMEOUT_MS)
    if (!options?.exited?.()) {
      proc.kill('SIGKILL')
    }
  }
}
