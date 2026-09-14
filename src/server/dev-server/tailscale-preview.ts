import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { resolve } from 'node:path'
import { logger } from '../utils/logger.js'

export interface PreviewStartResult {
  url: string
  remotePort: number
}

interface ActivePreview {
  child: ChildProcess
  remotePort: number
  url: string
  workdir: string
}

const STABILIZE_TIMEOUT_MS = 5000
const STABILIZE_POLL_MS = 200
const REMOVAL_VERIFY_TIMEOUT_MS = 3000
const REMOVAL_VERIFY_POLL_MS = 200

const CANDIDATE_HTTPS_PORTS = [443, 8443, 10000, 10443, 12345] as const

// eslint-disable-next-line no-control-regex
const URL_REGEX = /https?:\/\/[^\s\x1b]+/g
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;]*[A-Za-z]/g

function stripAnsi(s: string): string {
  return s.replace(ANSI_REGEX, '')
}

function trimTrailingPunctuation(url: string): string {
  return url.replace(/[.,;]+$/, '')
}

function extractFirstUrl(raw: string): string | null {
  const cleaned = stripAnsi(raw)
  URL_REGEX.lastIndex = 0
  const match = URL_REGEX.exec(cleaned)
  return match ? trimTrailingPunctuation(match[0]) : null
}

interface ServePortEntry {
  port: number
  host: string | null
}

/**
 * Collect { port, host } entries from a Tailscale serve status subtree.
 * Both root and `Foreground[*]` entries follow the same `{ TCP, Web }` shape,
 * so the same routine handles persistent and foreground-owned entries uniformly.
 *
 * Read-only: this never mutates the status. The targeted cleanup path is
 * responsible for *only* acting on the port passed to it (see forceRemoveEntry).
 */
function collectPortEntries(parent: unknown, out: ServePortEntry[]): void {
  if (!parent || typeof parent !== 'object') return
  const obj = parent as Record<string, unknown>

  const tcp = obj['TCP']
  if (tcp && typeof tcp === 'object') {
    for (const key of Object.keys(tcp)) {
      const n = parseInt(key, 10)
      if (!isNaN(n)) out.push({ port: n, host: null })
    }
  }

  const web = obj['Web']
  if (web && typeof web === 'object') {
    for (const key of Object.keys(web)) {
      const colonIdx = key.lastIndexOf(':')
      if (colonIdx === -1) continue
      const n = parseInt(key.slice(colonIdx + 1), 10)
      if (!isNaN(n)) out.push({ port: n, host: key.slice(0, colonIdx) })
    }
  }
}

/**
 * Normalized read of every port registered in the local Tailscale node —
 * root Web/TCP (persistent, e.g. the existing 443 → 10369 entry) and
 * `Foreground[*].Web` / `Foreground[*].TCP` (created by `tailscale serve` foreground).
 *
 * Consumed by:
 *   - port choice (`listUsedServePorts` / `pickFreeServePort`),
 *   - stabilization polling (`waitForEntry`),
 *   - removal verification (`waitForEntryGone`).
 */
export function iterateStatusPorts(status: unknown): ServePortEntry[] {
  const out: ServePortEntry[] = []
  if (!status || typeof status !== 'object') return out
  const root = status as Record<string, unknown>

  // Root-level Web/TCP entries — persistent serve config on the node.
  collectPortEntries(root, out)

  // Foreground entries — keyed by foreground-process PID. Each value carries its
  // own TCP + Web subtree, structurally identical to the root.
  const foreground = root['Foreground']
  if (foreground && typeof foreground === 'object') {
    for (const fgEntry of Object.values(foreground)) {
      collectPortEntries(fgEntry, out)
    }
  }

  return out
}

function parseUsedPortsFromStatusJson(status: unknown): number[] {
  return Array.from(new Set(iterateStatusPorts(status).map((p) => p.port)))
}

export async function isTailscaleAvailable(): Promise<{ available: boolean; nodeName?: string; reason?: string }> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile('tailscale', ['status', '--json'], { timeout: 4000, windowsHide: true }, (err, stdout) => {
        if (err) {
          const message = err.message || 'tailscale status failed'
          reject(new Error(message))
          return
        }
        resolve(stdout)
      })
    })
    const parsed = JSON.parse(stdout) as { BackendState?: string; Self?: { DNSName?: string } }
    if (parsed.BackendState !== 'Running') {
      return { available: false, reason: `Tailscale backend not running (${parsed.BackendState ?? 'unknown'})` }
    }
    const nodeName = parsed.Self?.DNSName?.replace(/\.$/, '')
    if (!nodeName) {
      return { available: false, reason: 'Tailscale node name not found' }
    }
    return { available: true, nodeName }
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

async function readServeStatusJson(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile('tailscale', ['serve', 'status', '--json'], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err) {
        reject(err)
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (parseErr) {
        reject(parseErr)
      }
    })
  })
}

export async function listUsedServePorts(): Promise<number[]> {
  try {
    const status = await readServeStatusJson()
    return parseUsedPortsFromStatusJson(status)
  } catch {
    return []
  }
}

export function pickFreeServePort(usedPorts: number[]): number {
  const used = new Set(usedPorts)
  for (const candidate of CANDIDATE_HTTPS_PORTS) {
    if (!used.has(candidate)) return candidate
  }
  for (let p = 443; p <= 65535; p++) {
    if (!used.has(p)) return p
  }
  throw new Error('No free HTTPS port available for Tailscale serve')
}

export function findEntryForPort(status: unknown, port: number): { webKey?: string; tcpKey?: string } {
  const result: { webKey?: string; tcpKey?: string } = {}
  for (const entry of iterateStatusPorts(status)) {
    if (entry.port !== port) continue
    if (entry.host) {
      result.webKey = `${entry.host}:${entry.port}`
    } else {
      result.tcpKey = String(entry.port)
    }
  }
  return result
}

async function waitForEntry(port: number, timeoutMs: number): Promise<{ webKey?: string; tcpKey?: string } | null> {
  const deadline = Date.now() + timeoutMs
  let lastSeen: { webKey?: string; tcpKey?: string } | null = null
  while (Date.now() < deadline) {
    try {
      const status = await readServeStatusJson()
      const found = findEntryForPort(status, port)
      if (found.webKey || found.tcpKey) return found
      lastSeen = found
    } catch {
      // ignore transient errors
    }
    await sleep(STABILIZE_POLL_MS)
  }
  return lastSeen
}

async function waitForEntryGone(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    let stillPresent = false
    try {
      const status = await readServeStatusJson()
      const found = findEntryForPort(status, port)
      if (found.webKey || found.tcpKey) stillPresent = true
    } catch {
      // ignore — assume still present to be safe
      stillPresent = true
    }
    if (!stillPresent) return true
    await sleep(REMOVAL_VERIFY_POLL_MS)
  }
  return false
}

async function forceRemoveEntry(workdir: string, handle: ActivePreview): Promise<void> {
  const removeArgs = ['serve', '--yes', `--https=${handle.remotePort}`, 'off']
  try {
    await new Promise<void>((resolve) => {
      const proc = spawn('tailscale', removeArgs, {
        stdio: 'ignore',
        windowsHide: true,
      })
      proc.once('exit', () => resolve())
      proc.once('error', () => resolve())
    })
  } catch (err) {
    logger.warn('Failed to remove persistent Tailscale serve entry', {
      workdir,
      remotePort: handle.remotePort,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  await waitForEntryGone(handle.remotePort, REMOVAL_VERIFY_TIMEOUT_MS)
}

function killChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (!child.pid || child.exitCode !== null) {
      resolve()
      return
    }
    const pid = child.pid
    let resolved = false
    const finish = () => {
      if (resolved) return
      resolved = true
      resolve()
    }
    child.once('exit', finish)
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // may already be dead
    }
    setTimeout(() => {
      if (resolved) return
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // may already be dead
      }
      setTimeout(finish, 200)
    }, 200)
  })
}

export class TailscalePreviewManager {
  private handles = new Map<string, ActivePreview>()

  isActive(workdir: string): boolean {
    return this.handles.has(this.resolve(workdir))
  }

  getActiveUrl(workdir: string): string | null {
    return this.handles.get(this.resolve(workdir))?.url ?? null
  }

  private resolve(workdir: string): string {
    return resolve(workdir)
  }

  async start(workdir: string, targetPort: number): Promise<PreviewStartResult> {
    const key = this.resolve(workdir)
    if (this.handles.has(key)) {
      throw new Error('A Tailscale preview is already active for this workdir')
    }

    const usedPorts = await listUsedServePorts()
    const remotePort = pickFreeServePort(usedPorts)

    const target = `http://localhost:${targetPort}`
    const args = ['serve', '--yes', `--https=${remotePort}`, target]

    const child = spawn('tailscale', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdoutBuf = ''
    let stderrBuf = ''
    let exited = false
    let exitCode: number | null = null
    const earlyExit = new Promise<{ code: number | null; stderr: string } | null>((resolve) => {
      child.once('error', (err) => {
        exited = true
        resolve({ code: -1, stderr: err.message })
      })
      child.once('exit', (code) => {
        exited = true
        exitCode = code
        resolve({ code, stderr: stderrBuf })
      })
    })

    child.stdout?.on('data', (data: Buffer) => {
      stdoutBuf += data.toString()
    })
    child.stderr?.on('data', (data: Buffer) => {
      stderrBuf += data.toString()
    })

    const entryCheck = waitForEntry(remotePort, STABILIZE_TIMEOUT_MS)
    const result = await Promise.race([
      earlyExit.then(async (exitInfo) => {
        if (exitInfo === null) return { ok: false as const, reason: 'spawn returned null child' }
        return {
          ok: false as const,
          reason: `tailscale serve exited before becoming active (code=${exitInfo.code ?? 'n/a'})`,
          stderr: exitInfo.stderr.trim(),
        }
      }),
      entryCheck.then(async (found) => {
        if (found && (found.webKey || found.tcpKey)) {
          const urlFromStdout = extractFirstUrl(stdoutBuf)
          const urlFromStatus = found.webKey ? `https://${found.webKey}/` : null
          const url = urlFromStdout ?? urlFromStatus
          if (url) {
            return { ok: true as const, url }
          }
          return {
            ok: false as const,
            reason: 'tailscale serve did not print a usable URL on stdout',
            stderr: stderrBuf.trim(),
          }
        }
        if (exited) {
          return {
            ok: false as const,
            reason: `tailscale serve exited (code=${exitCode ?? 'n/a'}) before registering the entry`,
            stderr: stderrBuf.trim(),
          }
        }
        return {
          ok: false as const,
          reason: 'tailscale serve did not register the entry in time',
          stderr: stderrBuf.trim(),
        }
      }),
    ])

    if (!result.ok) {
      await killChild(child)
      throw new Error(`${result.reason}${result.stderr ? `: ${result.stderr}` : ''}`)
    }

    const handle: ActivePreview = {
      child,
      remotePort,
      url: result.url,
      workdir: key,
    }
    this.handles.set(key, handle)

    logger.info('Tailscale preview started', { workdir: key, remotePort, url: result.url })

    return { url: result.url, remotePort }
  }

  async stop(workdir: string): Promise<void> {
    const key = this.resolve(workdir)
    const handle = this.handles.get(key)
    if (!handle) return
    this.handles.delete(key)
    try {
      await killChild(handle.child)
    } catch {
      // ignore
    }
    const gone = await waitForEntryGone(handle.remotePort, REMOVAL_VERIFY_TIMEOUT_MS)
    if (!gone) {
      await forceRemoveEntry(key, handle)
    }
    logger.info('Tailscale preview stopped', { workdir: key, remotePort: handle.remotePort })
  }

  async stopAll(): Promise<void> {
    const keys = Array.from(this.handles.keys())
    await Promise.allSettled(keys.map((k) => this.stop(k)))
  }
}

export const tailscalePreviewManager = new TailscalePreviewManager()
