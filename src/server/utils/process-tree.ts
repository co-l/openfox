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
 * Uses `ps` to enumerate the process tree on Unix, `taskkill` on Windows.
 */
export async function killProcessTree(pid: number): Promise<void> {
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

  const allPids = await getDescendantPids(pid)
  allPids.push(pid)

  for (const p of allPids) {
    killProcess(p, 'SIGTERM')
  }

  await sleep(SIGKILL_TIMEOUT_MS)

  for (const p of allPids) {
    killProcess(p, 'SIGKILL')
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

  if (options?.immediate) {
    const allPids = await getDescendantPids(pid)
    allPids.push(pid)
    for (const p of allPids) {
      killProcess(p, 'SIGKILL')
    }
    return
  }

  await killProcessTree(pid)
}
