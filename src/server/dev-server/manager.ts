import { type ChildProcess } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import net from 'node:net'
import { terminateProcessTree } from '../utils/process-tree.js'
import { logger } from '../utils/logger.js'
import { spawnShell } from '../utils/shell.js'
import type { DevServerConfig, DevServerState, DevServerStatus } from '../../shared/dev-server.js'
import { startInspectProxy } from './inspect-proxy.js'
import type { SessionManager } from '../session/manager.js'

const MAX_LOG_LINES = 2000
const MAX_LOG_BYTES = 100_000
const DEFAULT_PROBE_PORT = 10469
const MAX_PORT_SCAN = 200
const PROBE_TIMEOUT_MS = 300

const getDevServerConfigPath = (workdir: string) => {
  return join(resolve(workdir), '.openfox', 'dev.json')
}

// Patterns that indicate the server crashed even if the watcher stays alive
const ERROR_PATTERNS = [
  /EADDRINUSE/,
  /EACCES/,
  /ENOENT/,
  /Error: listen/,
  /Unhandled 'error' event/,
  /throw er;.*Unhandled/s,
  /Cannot find module/,
  /SyntaxError:/,
  /MODULE_NOT_FOUND/,
]

export interface LogChunk {
  stream: 'stdout' | 'stderr'
  content: string
}

export type OutputListener = (workdir: string, chunk: LogChunk) => void
export type StateListener = (workdir: string, state: DevServerState, errorMessage: string | undefined) => void

interface LogEntry {
  stream: 'stdout' | 'stderr'
  content: string
}

interface DevServerInstance {
  process: ChildProcess | null
  state: DevServerState
  config: DevServerConfig | null
  resolvedUrl: string | null
  resolvedCommand: string | null
  assignedPort: number | null
  logs: LogEntry[]
  totalLogBytes: number
  errorMessage: string | undefined
  exited: boolean
  inspectProxyPort: number | null
  proxyCleanup: (() => void) | null
}

function createInstance(): DevServerInstance {
  return {
    process: null,
    state: 'off',
    config: null,
    resolvedUrl: null,
    resolvedCommand: null,
    assignedPort: null,
    logs: [],
    totalLogBytes: 0,
    errorMessage: undefined,
    exited: true,
    inspectProxyPort: null,
    proxyCleanup: null,
  }
}

function parsePortFromUrl(url: string): { hostname: string; port: number } {
  const substituted = url.replace(/\$\{PORT\}/g, String(DEFAULT_PROBE_PORT))
  try {
    const parsed = new URL(substituted)
    const port = parsed.port ? parseInt(parsed.port, 10) : DEFAULT_PROBE_PORT
    return { hostname: parsed.hostname, port: isNaN(port) ? DEFAULT_PROBE_PORT : port }
  } catch {
    logger.warn('Failed to parse dev server URL, falling back to defaults', { url })
    return { hostname: '127.0.0.1', port: DEFAULT_PROBE_PORT }
  }
}

class DevServerManager {
  private instances = new Map<string, DevServerInstance>()
  private outputListeners = new Set<OutputListener>()
  private stateListeners = new Set<StateListener>()
  private _sessionManager: SessionManager | null = null

  setSessionManager(sm: SessionManager): void {
    this._sessionManager = sm
  }

  private resolveWorkdir(workdir: string): string {
    return resolve(workdir)
  }

  private getInstance(workdir: string): DevServerInstance {
    const key = this.resolveWorkdir(workdir)
    let instance = this.instances.get(key)
    if (!instance) {
      instance = createInstance()
      this.instances.set(key, instance)
    }
    return instance
  }

  private emitOutput(workdir: string, chunk: LogChunk) {
    const resolved = this.resolveWorkdir(workdir)
    for (const listener of this.outputListeners) {
      listener(resolved, chunk)
    }
  }

  private emitStateChange(workdir: string, state: DevServerState, errorMessage: string | undefined) {
    const resolved = this.resolveWorkdir(workdir)
    for (const listener of this.stateListeners) {
      listener(resolved, state, errorMessage)
    }
  }

  /** Probe whether a TCP port is in use */
  async probePort(host: string, port: number): Promise<boolean> {
    return new Promise((resolvePromise) => {
      const socket = new net.Socket()
      socket.setTimeout(PROBE_TIMEOUT_MS)
      socket.on('connect', () => {
        socket.destroy()
        resolvePromise(true)
      })
      socket.on('timeout', () => {
        socket.destroy()
        resolvePromise(false)
      })
      socket.on('error', () => {
        socket.destroy()
        resolvePromise(false)
      })
      socket.connect(port, host)
    })
  }

  /**
   * Find a free port starting from preferred, scanning upward.
   * Throws if no free port found within range.
   */
  async findFreePort(host: string, preferred: number): Promise<number> {
    const inUse = await this.probePort(host, preferred)
    if (!inUse) return preferred

    const maxPort = Math.min(preferred + MAX_PORT_SCAN, 65535)
    for (let port = preferred + 1; port <= maxPort; port++) {
      const taken = await this.probePort(host, port)
      if (!taken) return port
    }

    throw new Error(
      `No free port found in range ${preferred}-${maxPort} on ${host}. ` +
        `Close some applications or configure a different port in .openfox/dev.json`,
    )
  }

  /** Substitute ${PORT} placeholders with actual port number */
  substitutePort(template: string, port: number): string {
    return template.replace(/\$\{PORT\}/g, String(port))
  }

  /**
   * Load dev server config from workdir.
   * If not found and the path looks like a workspace (contains /workspaces/),
   * falls back to the parent project root.
   */
  async loadConfig(workdir: string): Promise<DevServerConfig | null> {
    const tryLoad = async (dir: string): Promise<DevServerConfig | null> => {
      try {
        const configPath = getDevServerConfigPath(dir)
        const raw = await readFile(configPath, 'utf-8')
        const parsed = JSON.parse(raw)
        if (!parsed.command || !parsed.url) return null
        return {
          command: parsed.command,
          url: parsed.url,
          hotReload: parsed.hotReload ?? false,
          disableInspect: parsed.disableInspect ?? false,
        }
      } catch {
        return null
      }
    }

    const config = await tryLoad(workdir)
    if (config) return config

    // Auto-detect workspace paths: <global-data-dir>/workspaces/<project>/<name>
    const wsIdx = workdir.indexOf('/workspaces/')
    if (wsIdx !== -1) {
      const projectRoot = workdir.slice(0, wsIdx)
      if (projectRoot !== workdir) {
        return tryLoad(projectRoot)
      }
    }

    return null
  }

  async saveConfig(workdir: string, config: DevServerConfig): Promise<void> {
    const resolved = this.resolveWorkdir(workdir)
    const dirPath = join(resolved, '.openfox')
    await mkdir(dirPath, { recursive: true })
    const configPath = getDevServerConfigPath(workdir)
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  }

  async start(workdir: string): Promise<DevServerStatus> {
    const instance = this.getInstance(workdir)

    // Stop existing process if running
    if (instance.state === 'running' && instance.process && !instance.exited) {
      await this.stop(workdir)
    }

    const config = await this.loadConfig(workdir)
    if (!config) {
      return this.getStatus(workdir)
    }

    // Port probing and auto-assignment
    const { hostname, port: configuredPort } = parsePortFromUrl(config.url)
    const assignedPort = await this.findFreePort(hostname, configuredPort)
    instance.assignedPort = assignedPort

    // Substitute ${PORT} template in command and url (in-memory only, config file untouched)
    const resolvedCommand = this.substitutePort(config.command, assignedPort)
    const resolvedUrl = this.substitutePort(config.url, assignedPort)
    instance.resolvedCommand = resolvedCommand
    instance.resolvedUrl = resolvedUrl

    instance.config = config
    instance.logs = []
    instance.totalLogBytes = 0
    instance.errorMessage = undefined
    instance.exited = false

    // Start inspect proxy if not disabled
    if (!config.disableInspect && resolvedUrl && this._sessionManager) {
      try {
        const { port, cleanup } = await startInspectProxy(resolvedUrl, this._sessionManager, assignedPort, workdir)
        instance.inspectProxyPort = port
        instance.proxyCleanup = cleanup
        logger.debug('Inspect proxy started', { workdir, port, target: resolvedUrl })
      } catch (err) {
        logger.warn('Failed to start inspect proxy', { workdir, error: err })
      }
    }

    const resolved = this.resolveWorkdir(workdir)

    const proc = spawnShell(resolvedCommand, {
      cwd: resolved,
      detached: true,
    })

    instance.process = proc

    const appendLog = (stream: 'stdout' | 'stderr', content: string) => {
      const entry: LogEntry = { stream, content }
      instance.logs.push(entry)
      instance.totalLogBytes += content.length
      while (instance.logs.length > MAX_LOG_LINES || instance.totalLogBytes > MAX_LOG_BYTES) {
        const removed = instance.logs.shift()
        if (removed) instance.totalLogBytes -= removed.content.length
      }
    }

    proc.stdout?.on('data', (data: Buffer) => {
      const content = data.toString()
      appendLog('stdout', content)
      this.emitOutput(workdir, { stream: 'stdout', content })
    })

    // Detect error patterns in stderr — set warning if process is still running
    proc.stderr?.on('data', (data: Buffer) => {
      const content = data.toString()
      appendLog('stderr', content)
      this.emitOutput(workdir, { stream: 'stderr', content })

      if (instance.state === 'running' && ERROR_PATTERNS.some((p) => p.test(content))) {
        instance.state = 'warning'
        instance.errorMessage = content.trim().slice(0, 500)
        this.emitStateChange(workdir, 'warning', instance.errorMessage)
      }
    })

    proc.on('close', (code) => {
      instance.exited = true
      instance.process = null
      if (code !== 0 && code !== null) {
        const recentLogs = instance.logs.slice(-10).join('')
        const errorMessage = `Process exited with code ${code}\n${recentLogs}`.trim()
        instance.state = 'error'
        instance.errorMessage = errorMessage
        this.emitStateChange(workdir, 'error', errorMessage)
      } else {
        instance.state = 'off'
        instance.errorMessage = undefined
        this.emitStateChange(workdir, 'off', undefined)
      }
    })

    proc.on('error', (err) => {
      instance.exited = true
      instance.process = null
      instance.state = 'error'
      instance.errorMessage = err.message
      this.emitStateChange(workdir, 'error', err.message)
    })

    instance.state = 'running'
    instance.errorMessage = undefined
    this.emitStateChange(workdir, 'running', undefined)
    logger.info('Dev server started', { workdir, command: resolvedCommand, port: assignedPort })

    return this.getStatus(workdir)
  }

  async stop(workdir: string): Promise<DevServerStatus> {
    const instance = this.getInstance(workdir)

    if (instance.process && !instance.exited) {
      await terminateProcessTree(instance.process, { exited: () => instance.exited })
      instance.process = null
      instance.exited = true
      instance.state = 'off'
      instance.errorMessage = undefined
      this.emitStateChange(workdir, 'off', undefined)
      logger.info('Dev server stopped', { workdir })
    }

    // Cleanup inspect proxy
    if (instance.proxyCleanup) {
      instance.proxyCleanup()
      instance.proxyCleanup = null
      instance.inspectProxyPort = null
    }

    return this.getStatus(workdir)
  }

  async restart(workdir: string): Promise<DevServerStatus> {
    await this.stop(workdir)
    return this.start(workdir)
  }

  getStatus(workdir: string): DevServerStatus {
    const instance = this.getInstance(workdir)
    return {
      state: instance.state,
      url: instance.resolvedUrl ?? instance.config?.url ?? null,
      hotReload: instance.config?.hotReload ?? false,
      config: instance.config,
      errorMessage: instance.errorMessage,
      inspectProxyPort: instance.inspectProxyPort,
    }
  }

  getLogs(workdir: string): LogEntry[] {
    const instance = this.getInstance(workdir)
    return [...instance.logs]
  }

  getLogsSlice(workdir: string, offset: number, limit: number): { logs: LogEntry[]; total: number } {
    const allLogs = this.getLogs(workdir)
    const total = allLogs.length
    const logs = allLogs.slice(offset, offset + limit)
    return { logs, total }
  }

  /** Register a global listener for output from any dev server */
  onOutput(callback: OutputListener): () => void {
    this.outputListeners.add(callback)
    return () => {
      this.outputListeners.delete(callback)
    }
  }

  /** Register a global listener for state changes from any dev server */
  onStateChange(callback: StateListener): () => void {
    this.stateListeners.add(callback)
    return () => {
      this.stateListeners.delete(callback)
    }
  }

  async stopAll(): Promise<void> {
    const stops = Array.from(this.instances.keys()).map((workdir) => this.stop(workdir))
    await Promise.allSettled(stops)
    this.instances.clear()
  }
}

export const devServerManager = new DevServerManager()
