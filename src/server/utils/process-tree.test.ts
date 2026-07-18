import { describe, it, expect } from 'vitest'
import { spawn, execFile } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { terminateProcessTree } from './process-tree.js'

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Collect all descendant PIDs via ps (Unix) or CIM (Windows, where ps does not exist) */
async function getDescendants(rootPid: number): Promise<number[]> {
  const [cmd, args] =
    process.platform === 'win32'
      ? ([
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }',
          ],
        ] as const)
      : (['ps', ['-eo', 'pid=,ppid=']] as const)
  const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
    execFile(cmd, [...args], { timeout: 15000, windowsHide: true }, (err, stdout) => {
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
}

// Node-based process tree: a parent that spawns two long-lived children which
// inherit the parent's stdio (so pipe-holding scenarios are covered). node
// instead of bash so the tree is visible to the host OS on Windows (a PATH
// "bash" may be WSL, whose children live outside the host process table).
const TREE_SCRIPT = [
  "const { spawn } = require('child_process');",
  "spawn(process.execPath, ['-e', 'setTimeout(() => {}, 100000)'], { stdio: 'inherit' });",
  "spawn(process.execPath, ['-e', 'setTimeout(() => {}, 200000)'], { stdio: 'inherit' });",
  'setInterval(() => {}, 1000);',
].join('\n')

describe('terminateProcessTree', () => {
  it('kills a simple sleep process', async () => {
    const proc = spawn('sleep', ['30'], { stdio: 'ignore', detached: true })
    expect(proc.pid).toBeTruthy()
    expect(isAlive(proc.pid!)).toBe(true)

    await terminateProcessTree(proc)
    await sleep(100)

    expect(isAlive(proc.pid!)).toBe(false)
  })

  it('kills all descendants of a shell process', async () => {
    const proc = spawn(process.execPath, ['-e', TREE_SCRIPT], { stdio: 'ignore', detached: true })

    expect(proc.pid).toBeTruthy()
    await sleep(400)

    const descendants = await getDescendants(proc.pid!)
    expect(descendants.length).toBeGreaterThanOrEqual(2)

    // All should be alive before termination
    for (const pid of descendants) {
      expect(isAlive(pid)).toBe(true)
    }

    // Terminate the tree
    await terminateProcessTree(proc)
    await sleep(300)

    // All should be dead now
    expect(isAlive(proc.pid!)).toBe(false)
    for (const pid of descendants) {
      expect(isAlive(pid)).toBe(false)
    }
  }, 20000)

  it('handles already-exited process gracefully', async () => {
    const proc = spawn('echo', ['hi'], { stdio: 'ignore' })
    await new Promise<void>((resolve) => proc.on('close', () => resolve()))
    await expect(terminateProcessTree(proc)).resolves.toBeUndefined()
  })

  it('handles null pid gracefully', async () => {
    const fakeProc = { pid: undefined } as any
    await expect(terminateProcessTree(fakeProc)).resolves.toBeUndefined()
  })

  it('handles nonexistent pid gracefully', async () => {
    const fakeProc = { pid: 999999999 } as any
    await expect(terminateProcessTree(fakeProc)).resolves.toBeUndefined()
  })

  it('fires close event after killing process group', async () => {
    // Spawn a shell with a foreground child that holds the pipe open
    const proc = spawn('bash', ['-c', 'sleep 300'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })

    expect(proc.pid).toBeTruthy()
    expect(isAlive(proc.pid!)).toBe(true)

    // Track close event
    let closed = false
    proc.on('close', () => {
      closed = true
    })

    await terminateProcessTree(proc)
    await sleep(300)

    expect(closed).toBe(true)
    expect(isAlive(proc.pid!)).toBe(false)
  })

  it('kills process group with immediate mode', async () => {
    const proc = spawn(process.execPath, ['-e', TREE_SCRIPT], {
      stdio: 'ignore',
      detached: true,
    })

    expect(proc.pid).toBeTruthy()
    await sleep(300)

    const descendants = await getDescendants(proc.pid!)
    expect(descendants.length).toBeGreaterThanOrEqual(1)

    await terminateProcessTree(proc, { immediate: true })
    await sleep(300)

    expect(isAlive(proc.pid!)).toBe(false)
    for (const pid of descendants) {
      expect(isAlive(pid)).toBe(false)
    }
  }, 20000)

  it('kills orphan-capable process group (child inheriting pipes)', async () => {
    // Simulate the pasta scenario: shell spawns a foreground child that
    // holds stdout/stderr pipes open. Process group kill must take down
    // both shell and child so pipes close and the parent gets EOF.
    const proc = spawn(process.execPath, ['-e', TREE_SCRIPT], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })

    expect(proc.pid).toBeTruthy()
    await sleep(400)

    // Confirm children are alive
    const descendants = await getDescendants(proc.pid!)
    expect(descendants.length).toBeGreaterThanOrEqual(1)

    let closed = false
    proc.on('close', () => {
      closed = true
    })

    await terminateProcessTree(proc)
    await sleep(300)

    expect(closed).toBe(true)
    expect(isAlive(proc.pid!)).toBe(false)
    for (const pid of descendants) {
      expect(isAlive(pid)).toBe(false)
    }
  }, 20000)
})
