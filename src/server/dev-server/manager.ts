import { spawn, type ChildProcess } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { terminateProcessTree } from '../utils/process-tree.js'
import { logger } from '../utils/logger.js'
import { getPlatformShell } from '../utils/platform.js'
import type { DevServerConfig, DevServerState, DevServerStatus } from '../../shared/dev-server.js'

const MAX_LOG_LINES = 2000
const MAX_LOG_BYTES = 100_000
const CONFIG_PATH = '.openfox/dev.json'

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
  logs: LogEntry[]
  totalLogBytes: number
  errorMessage: string | undefined
  exited: boolean
}

function createInstance(): DevServerInstance {
  return {
    process: null,
    state: 'off',
    config: null,
    logs: [],
    totalLogBytes: 0,
    errorMessage: undefined,
    exited: true,
  }
}

class DevServerManager {
  private instances = new Map<string, DevServerInstance>()
  private outputListeners = new Set<OutputListener>()
  private stateListeners = new Set<StateListener>()

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

  async loadConfig(workdir: string): Promise<DevServerConfig | null> {
    try {
      const configPath = join(this.resolveWorkdir(workdir), CONFIG_PATH)
      const raw = await readFile(configPath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (!parsed.command || !parsed.url) return null
      return {
        command: parsed.command,
        url: parsed.url,
        hotReload: parsed.hotReload ?? false,
      }
    } catch {
      return null
    }
  }

  async saveConfig(workdir: string, config: DevServerConfig): Promise<void> {
    const resolved = this.resolveWorkdir(workdir)
    const dirPath = join(resolved, '.openfox')
    await mkdir(dirPath, { recursive: true })
    const configPath = join(resolved, CONFIG_PATH)
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

    instance.config = config
    instance.logs = []
    instance.totalLogBytes = 0
    instance.errorMessage = undefined
    instance.exited = false

    const resolved = this.resolveWorkdir(workdir)

    const shell = getPlatformShell()
    const proc = spawn(shell.command, [...shell.args, config.command], {
      cwd: resolved,
      env: { ...process.env, FORCE_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
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

    proc.stderr?.on('data', (data: Buffer) => {
      const content = data.toString()
      appendLog('stderr', content)
      this.emitOutput(workdir, { stream: 'stderr', content })

      // Detect error patterns in stderr — set warning if process is still running
      if (instance.state === 'running' && ERROR_PATTERNS.some(p => p.test(content))) {
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
    logger.info('Dev server started', { workdir, command: config.command })

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
      url: instance.config?.url ?? null,
      hotReload: instance.config?.hotReload ?? false,
      config: instance.config,
      errorMessage: instance.errorMessage,
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
    return () => { this.outputListeners.delete(callback) }
  }

  /** Register a global listener for state changes from any dev server */
  onStateChange(callback: StateListener): () => void {
    this.stateListeners.add(callback)
    return () => { this.stateListeners.delete(callback) }
  }

  async stopAll(): Promise<void> {
    const stops = Array.from(this.instances.keys()).map(workdir => this.stop(workdir))
    await Promise.allSettled(stops)
    this.instances.clear()
  }
}

export const devServerManager = new DevServerManager()
