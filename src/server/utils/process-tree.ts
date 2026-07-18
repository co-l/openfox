import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const SIGKILL_TIMEOUT_MS = 200

async function getDescendantPids(rootPid: number): Promise<number[]> {
  try {
    const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      execFile('ps', ['-eo', 'pid=,ppid='], { timeout: 5000, windowsHide: true }, (err, stdout) => {
        if (err) reject(err)
        else resolve({ stdout })
      })
    })

    const children = new Map<number, number[]>()

    for (const line of stdout.trim().split('\n')) {
      const parts = line.trim().split(/\s+/)
      const pid = parseInt(parts[0]!, 10)
      const ppid = parseInt(parts[1]!, 10)
      if (!isNaN(pid) && !isNaN(ppid) && pid > 0 && ppid >= 0) {
        if (!children.has(ppid)) children.set(ppid, [])
        children.get(ppid)!.push(pid)
      }
    }

    const descendants: number[] = []
    const queue = [rootPid]
    while (queue.length > 0) {
      const current = queue.shift()!
      const kids = children.get(current)
      if (kids) {
        for (const kid of kids) {
          descendants.push(kid)
          queue.push(kid)
        }
      }
    }
    return descendants
  } catch {
    return []
  }
}

function killProcess(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void {
  try {
    process.kill(pid, signal)
  } catch {
    // May have already exited
  }
}

/**
 * Kill a process and all its descendants.
 *
 * On Unix, uses process group signaling (SIGTERM → SIGKILL) as the primary
 * mechanism.  Since `detached: true` makes the spawned process the leader of
 * a new process group, `kill(-pid, …)` reaches the shell and every process
 * it spawned — including backgrounded children that inherited the shell's
 * stdio pipes.  This avoids the "zombie pipe" problem where a surviving
 * child keeps pipe write-ends open, preventing the parent from ever
 * receiving the `close` event.
 *
 * Falls back to individual PID enumeration via `ps` for edge cases where
 * children created their own process groups (e.g. via `setsid`).
 *
 * On Windows, delegates to `taskkill /f /t`.
 */
export async function killProcessTree(pid: number, immediate = false): Promise<void> {
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

  // Primary: kill by process group (negative PID = PGID).
  // With detached: true the child is the process group leader,
  // so this kills the shell and all its descendants atomically.
  if (!immediate) {
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      /* may already be gone */
    }
    await sleep(SIGKILL_TIMEOUT_MS)
  }

  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    /* may already be gone */
  }

  // Fallback: enumerate individual PIDs for any survivors
  // (edge case: children that called setsid to create separate groups).
  const survivors = await getDescendantPids(pid)
  if (survivors.length > 0) {
    survivors.push(pid)
    for (const p of survivors) {
      killProcess(p, 'SIGKILL')
    }
  }
}

/**
 * Kill a ChildProcess and all its descendants.
 * Convenience wrapper around `killProcessTree`.
 */
export async function terminateProcessTree(
  proc: ChildProcess,
  options?: { exited?: () => boolean; immediate?: boolean },
): Promise<void> {
  const pid = proc.pid
  if (!pid || options?.exited?.()) {
    return
  }

  await killProcessTree(pid, options?.immediate ?? false)
}
