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

/**
 * Termination is not synchronous — `taskkill /f /t` in particular returns before
 * Windows has finished reaping the tree, and the close event trails the exit — so
 * a fixed sleep before asserting is a race that loses under parallel test load.
 * Poll instead; on timeout we fall through and let the assertion do the reporting.
 */
async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && !(await condition())) await sleep(50)
}

/**
 * Poll until the tree under rootPid has at least `min` descendants. A fixed
 * settle sleep after spawn loses on slow runners: the children may not have
 * been forked yet, and a tree kill issued before they exist lets them escape
 * the taskkill snapshot on Windows and hold inherited pipes open forever.
 */
async function waitForDescendants(rootPid: number, min: number): Promise<number[]> {
  let descendants: number[] = []
  await waitFor(async () => {
    descendants = await getDescendants(rootPid)
    return descendants.length >= min
  })
  return descendants
}

const allDead =
  (...pids: number[]) =>
  () =>
    !pids.some(isAlive)

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
    await waitFor(allDead(proc.pid!))

    expect(isAlive(proc.pid!)).toBe(false)
  })

  it('kills all descendants of a shell process', async () => {
    const proc = spawn(process.execPath, ['-e', TREE_SCRIPT], { stdio: 'ignore', detached: true })

    expect(proc.pid).toBeTruthy()
    const descendants = await waitForDescendants(proc.pid!, 2)
    expect(descendants.length).toBeGreaterThanOrEqual(2)

    // All should be alive before termination
    for (const pid of descendants) {
      expect(isAlive(pid)).toBe(true)
    }

    // Terminate the tree
    await terminateProcessTree(proc)
    await waitFor(allDead(proc.pid!, ...descendants))

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

    // On Windows, MSYS bash cannot exec-replace itself the way Unix bash does
    // with a single command: 'sleep 300' runs as a child sleep.exe holding the
    // inherited pipes. Terminating before that child exists lets it escape the
    // taskkill tree snapshot and keep the pipes open — 'close' then never
    // fires (flaked exactly this way on the CI runner). On Unix bash execs
    // into sleep, so there is no child to wait for.
    if (process.platform === 'win32') await waitForDescendants(proc.pid!, 1)

    await terminateProcessTree(proc)
    await waitFor(() => closed && !isAlive(proc.pid!))

    expect(closed).toBe(true)
    expect(isAlive(proc.pid!)).toBe(false)
  })

  it('kills process group with immediate mode', async () => {
    const proc = spawn(process.execPath, ['-e', TREE_SCRIPT], {
      stdio: 'ignore',
      detached: true,
    })

    expect(proc.pid).toBeTruthy()
    // TREE_SCRIPT always spawns two children — wait for both, or the kill can
    // race the second one's launch (its inherited pipe closes mid-start, which
    // surfaces as an ERROR_NO_DATA dialog on Windows and a possible orphan).
    const descendants = await waitForDescendants(proc.pid!, 2)
    expect(descendants.length).toBeGreaterThanOrEqual(1)

    await terminateProcessTree(proc, { immediate: true })
    await waitFor(allDead(proc.pid!, ...descendants))

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

    // Confirm children are alive (TREE_SCRIPT spawns two — wait for both so
    // the kill cannot race the second child's launch)
    const descendants = await waitForDescendants(proc.pid!, 2)
    expect(descendants.length).toBeGreaterThanOrEqual(1)

    let closed = false
    proc.on('close', () => {
      closed = true
    })

    await terminateProcessTree(proc)
    await waitFor(() => closed && allDead(proc.pid!, ...descendants)())

    expect(closed).toBe(true)
    expect(isAlive(proc.pid!)).toBe(false)
    for (const pid of descendants) {
      expect(isAlive(pid)).toBe(false)
    }
  }, 20000)
})
