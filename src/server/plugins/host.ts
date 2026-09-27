import { readdir, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { EventStore } from '../events/store.js'
import type { StoredEvent } from '../events/types.js'
import type { Tool, ToolContext } from '../tools/types.js'
import type { CommandDefinition } from '../commands/types.js'
import type { SkillDefinition } from '../skills/types.js'
import { setPluginTools } from '../tools/index.js'
import { getBuiltInToolNames } from '../tools/index.js'
import { setPluginCommands } from '../commands/registry.js'
import { setPluginSkills } from '../skills/registry.js'
import { getAllSettings, setSetting } from '../db/settings.js'
import type { ServerMessage } from '../../shared/protocol.js'
import { createServerMessage } from '../../shared/protocol.js'
import type {
  PluginContributionSummary,
  PluginInfo,
  PluginSettingScope,
  PluginSettingValue,
  PluginSettingsValues,
  PluginUiContributions,
} from '../../shared/plugin.js'
import type {
  PluginContext,
  PluginDefinition,
  PluginHookEvent,
  PluginManifest,
  PluginNotificationRequest,
  PluginTool,
  PluginToolContext,
} from '../../plugin/index.js'
import { PluginRegistry } from './registry.js'
import { HookBus, type HookLogger } from './hooks.js'
import { NotificationService } from './notifications.js'
import { loadPluginFromDirectory, loadPlugins, readPluginManifest, type PluginDiagnostic } from './loader.js'
import { installPluginFromGithub, installPluginFromNpm, installPluginFromPath, removeNpmArtifacts } from './install.js'
import { readPluginSettings, readPluginSettingsView, writePluginSettings } from './settings.js'
import { setPluginModelMetadataProviders } from './model-metadata.js'
import { setPluginHookEmitter } from './hook-emitter.js'

const DISABLED_KEY = 'plugin.disabled'

export interface PluginHostOptions {
  configDirectory: string
  mode: 'production' | 'development'
  logger: HookLogger
  cwd?: string
  rpcTimeoutMs?: number
  registry?: PluginRegistry
}

interface PluginRecord {
  diagnostic: PluginDiagnostic
  context: PluginContext
  enabled: boolean
  deactivate?: () => void | Promise<void>
}

export class PluginHost {
  readonly registry: PluginRegistry
  readonly hooks: HookBus
  readonly notifications: NotificationService
  private readonly records = new Map<string, PluginRecord>()
  private readonly pendingDeactivates = new Map<string, () => void | Promise<void>>()
  private readonly logger: HookLogger
  private readonly rpcTimeoutMs: number

  constructor(private readonly options: PluginHostOptions) {
    this.logger = options.logger
    this.rpcTimeoutMs = options.rpcTimeoutMs ?? 30000
    this.registry =
      options.registry ?? new PluginRegistry({ mode: options.mode, configDirectory: options.configDirectory })
    this.hooks = new HookBus(this.registry, options.logger)
    this.notifications = new NotificationService()
  }

  async start(): Promise<PluginDiagnostic[]> {
    const disabled = this.readDisabled()
    this.registry.setReservedToolNames(getBuiltInToolNames())
    const diagnostics = await loadPlugins({
      registry: this.registry,
      configDirectory: this.options.configDirectory,
      ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
      createContext: (manifest, source) => this.createContext(manifest, source),
      onModule: (packageName, module) => this.captureModule(packageName, module),
      shouldLoad: (packageName) => !disabled.includes(packageName),
    })
    for (const diagnostic of diagnostics) {
      this.records.set(diagnostic.packageName, {
        diagnostic,
        context: this.contextFor(diagnostic),
        enabled: !disabled.includes(diagnostic.packageName),
        ...(this.pendingDeactivates.has(diagnostic.packageName)
          ? { deactivate: this.pendingDeactivates.get(diagnostic.packageName)! }
          : {}),
      })
    }
    this.pendingDeactivates.clear()
    this.applyContributions()
    setPluginHookEmitter((event, payload) => {
      void this.hooks.emit(event, payload)
    })
    return diagnostics
  }

  getDiagnostics(): PluginDiagnostic[] {
    return [...this.records.values()].map((record) => record.diagnostic)
  }

  getPlugins(): PluginInfo[] {
    return [...this.records.values()].map((record) => ({
      id: record.diagnostic.packageName,
      displayName: record.diagnostic.displayName,
      ...(record.diagnostic.description ? { description: record.diagnostic.description } : {}),
      ...(record.diagnostic.icon ? { icon: record.diagnostic.icon } : {}),
      ...(record.diagnostic.logo ? { logo: record.diagnostic.logo } : {}),
      version: record.diagnostic.version ?? '0.0.0',
      apiVersion: (record.diagnostic.apiVersion === 1 ? 1 : 2) as 1 | 2,
      source: record.diagnostic.source,
      enabled: record.enabled,
      loaded: record.diagnostic.loaded,
      ...(record.diagnostic.error ? { error: record.diagnostic.error } : {}),
      capabilities: record.diagnostic.capabilities,
      contributions: record.diagnostic.contributions,
      removable: this.isRemovable(record.diagnostic.source),
    }))
  }

  getContributions(pluginId: string): PluginContributionSummary {
    return this.registry.getContributionSummary(pluginId)
  }

  getUiContributions(): PluginUiContributions {
    return this.registry.getUiContributions()
  }

  getSettingsSchema(pluginId: string) {
    return this.registry.getSettingsSchema(pluginId)
  }

  getSettingsView(
    pluginId: string,
    scope: PluginSettingScope = 'global',
    projectId?: string,
  ): { values: PluginSettingsValues; secretsSet: string[] } {
    const schema = this.registry.getSettingsSchema(pluginId)
    if (!schema) return { values: {}, secretsSet: [] }
    return readPluginSettingsView(pluginId, schema, scope, projectId)
  }

  updateSettings(
    pluginId: string,
    values: Record<string, unknown>,
    scope: PluginSettingScope = 'global',
    projectId?: string,
  ): { errors: string[] } {
    const schema = this.registry.getSettingsSchema(pluginId)
    if (!schema) return { errors: [`Plugin '${pluginId}' does not declare settings`] }
    return writePluginSettings(pluginId, schema, values, scope, projectId)
  }

  async invokeRpc(
    pluginId: string,
    method: string,
    params: Record<string, unknown>,
    context: PluginToolContext,
  ): Promise<unknown> {
    const record = this.records.get(pluginId)
    if (!record || !record.enabled) throw new Error(`Plugin '${pluginId}' is not enabled`)
    if (record.diagnostic.capabilities.length > 0 && !record.diagnostic.capabilities.includes('rpc')) {
      throw new Error(`Plugin '${pluginId}' does not declare the 'rpc' capability`)
    }
    const handler = this.registry.getRpcHandler(pluginId, method)
    if (!handler) throw new Error(`Plugin '${pluginId}' has no RPC method '${method}'`)
    return withTimeout(Promise.resolve(handler(params, context)), record.diagnostic.timeoutMs ?? this.rpcTimeoutMs)
  }

  getPluginTools(): { name: string; description: string; pluginId: string }[] {
    return this.registry
      .getOwnedTools()
      .map((entry) => ({ name: entry.tool.name, description: entry.tool.description, pluginId: entry.pluginId }))
  }

  async enable(pluginId: string): Promise<void> {
    const record = this.records.get(pluginId)
    if (!record) throw new Error(`Plugin '${pluginId}' is not installed`)
    if (record.enabled) return
    const manifest = await readPluginManifest(record.diagnostic.source)
    if (!manifest) throw new Error(`Plugin '${pluginId}' manifest is unreadable`)
    const diagnostic = await loadPluginFromDirectory({
      registry: this.registry,
      packageDir: record.diagnostic.source,
      manifest,
      createContext: (m, source) => this.createContext(m, source),
      onModule: (packageName, module) => this.captureModule(packageName, module),
      cacheBust: true,
    })
    record.diagnostic = diagnostic
    record.enabled = diagnostic.loaded
    if (diagnostic.loaded) this.writeDisabled(this.readDisabled().filter((id) => id !== pluginId))
    this.applyContributions()
  }

  async disable(pluginId: string): Promise<void> {
    const record = this.records.get(pluginId)
    if (!record) throw new Error(`Plugin '${pluginId}' is not installed`)
    await this.runDeactivate(pluginId, record)
    this.registry.removePlugin(pluginId)
    record.enabled = false
    const disabled = this.readDisabled()
    if (!disabled.includes(pluginId)) this.writeDisabled([...disabled, pluginId])
    this.applyContributions()
  }

  async uninstall(pluginId: string): Promise<void> {
    const record = this.records.get(pluginId)
    if (!record) throw new Error(`Plugin '${pluginId}' is not installed`)
    if (!this.isRemovable(record.diagnostic.source)) {
      throw new Error(
        `Plugin '${pluginId}' was discovered outside ${this.pluginsDir()} and cannot be removed by OpenFox`,
      )
    }
    await this.runDeactivate(pluginId, record)
    this.registry.removePlugin(pluginId)
    this.records.delete(pluginId)
    this.writeDisabled(this.readDisabled().filter((id) => id !== pluginId))
    await rm(record.diagnostic.source, { recursive: true, force: true })
    await this.cleanupNpmArtifacts(record.diagnostic.source)
    this.applyContributions()
  }

  /**
   * After uninstalling an npm-installed plugin, drop the install bookkeeping
   * (`package.json`, lockfiles) once its `node_modules` is empty so the
   * plugins directory keeps containing only plugin packages.
   */
  private async cleanupNpmArtifacts(source: string): Promise<void> {
    const nodeModules = join(this.pluginsDir(), 'node_modules')
    if (resolve(source, '..') !== resolve(nodeModules)) return
    let entries: string[]
    try {
      entries = await readdir(nodeModules)
    } catch {
      return
    }
    if (entries.length > 0) return
    await rm(nodeModules, { recursive: true, force: true })
    await removeNpmArtifacts(this.pluginsDir())
  }

  async installFromGithub(githubUrl: string): Promise<PluginDiagnostic> {
    const dir = await installPluginFromGithub(githubUrl, this.pluginsDir())
    return this.installFromDirectory(dir)
  }

  async installFromNpm(packageName: string): Promise<PluginDiagnostic> {
    const dir = await installPluginFromNpm(packageName, this.pluginsDir())
    return this.installFromDirectory(dir)
  }

  async installFromPath(sourcePath: string): Promise<PluginDiagnostic> {
    const dir = await installPluginFromPath(sourcePath, this.pluginsDir())
    return this.installFromDirectory(dir)
  }

  private async installFromDirectory(dir: string): Promise<PluginDiagnostic> {
    const manifest = await readPluginManifest(dir)
    if (!manifest) throw new Error('Installed package is not an OpenFox plugin (missing openfox manifest)')
    const diagnostic = await loadPluginFromDirectory({
      registry: this.registry,
      packageDir: dir,
      manifest,
      createContext: (m, source) => this.createContext(m, source),
      cacheBust: true,
    })
    this.records.set(diagnostic.packageName, {
      diagnostic,
      context: this.createContext(manifest, dir),
      enabled: diagnostic.loaded,
    })
    if (diagnostic.loaded) this.writeDisabled(this.readDisabled().filter((id) => id !== diagnostic.packageName))
    this.applyContributions()
    return diagnostic
  }

  async notify(pluginId: string, request: PluginNotificationRequest): Promise<void> {
    this.notifications.emit(pluginId, request)
  }

  attachEventStore(eventStore: EventStore): void {
    const { iterator } = eventStore.subscribeAll()
    void (async () => {
      for await (const event of iterator) {
        await this.handleStoredEvent(event)
      }
    })()
  }

  private async handleStoredEvent(event: StoredEvent): Promise<void> {
    const payload = event.data as Record<string, unknown>
    const sessionId = event.sessionId
    const base = {
      sessionId,
      ...(typeof payload['projectId'] === 'string' ? { projectId: payload['projectId'] } : {}),
      data: payload,
    }

    if (event.type === 'chat.done') {
      // `step_done` marks the end of a workflow step; anything else is a turn.
      await this.hooks.emit(payload['reason'] === 'step_done' ? 'workflow.step.completed' : 'turn.completed', base)
      return
    }

    const mapping = EVENT_HOOK_MAP[event.type]
    if (!mapping) return
    await this.hooks.emit(mapping, base)
  }

  private applyContributions(): void {
    setPluginTools(this.registry.getTools().map((tool) => toServerTool(tool)))
    setPluginCommands(
      this.registry.getOwnedCommands().map((entry) => toCommandDefinition(entry.command, entry.pluginId)),
    )
    setPluginModelMetadataProviders(this.registry.getModelMetadataProviders())
    void this.refreshSkillSources()
  }

  private async refreshSkillSources(): Promise<void> {
    const sources = this.registry.getSkillSources()
    const skills: SkillDefinition[] = []
    for (const source of sources) {
      try {
        for (const skill of await source.load()) {
          skills.push({
            metadata: { id: skill.id, name: skill.name, description: skill.description, version: '1.0.0' },
            prompt: skill.prompt,
            source: 'plugin',
          })
        }
      } catch (error) {
        this.logger.warn('Plugin skill source failed', { source: source.id, error: String(error) })
      }
    }
    setPluginSkills(skills)
  }

  private captureModule(packageName: string, module: Partial<PluginDefinition>): void {
    const deactivate =
      typeof module.deactivate === 'function'
        ? (module.deactivate.bind(module) as () => void | Promise<void>)
        : undefined
    const record = this.records.get(packageName)
    if (record) {
      if (deactivate) record.deactivate = deactivate
      else delete record.deactivate
      return
    }
    if (deactivate) this.pendingDeactivates.set(packageName, deactivate)
    else this.pendingDeactivates.delete(packageName)
  }

  private async runDeactivate(pluginId: string, record: PluginRecord): Promise<void> {
    const deactivate = record.deactivate
    if (!deactivate) return
    delete record.deactivate
    try {
      await deactivate()
    } catch (error) {
      this.logger.warn('Plugin deactivate failed', { pluginId, error: String(error) })
    }
  }

  private isRemovable(source: string): boolean {
    const root = resolve(this.pluginsDir())
    const target = resolve(source)
    return target === root || target.startsWith(`${root}${sep}`)
  }

  private createContext(manifest: PluginManifest, _source: string): PluginContext {
    const pluginId = manifest.name
    return {
      id: pluginId,
      version: manifest.version,
      runtime: { mode: this.options.mode, configDirectory: this.options.configDirectory },
      logger: {
        debug: (message, context) => this.logger.debug(message, { pluginId, ...context }),
        info: (message, context) => this.logger.info(message, { pluginId, ...context }),
        warn: (message, context) => this.logger.warn(message, { pluginId, ...context }),
        error: (message, context) => this.logger.error(message, { pluginId, ...context }),
      },
      storage: {
        get: (key) => readStorageValue(pluginId, key),
        set: (key, value) => setSetting(storageKey(pluginId, key), JSON.stringify(value)),
      },
      settings: (scope = 'global', projectId) => {
        const schema = this.registry.getSettingsSchema(pluginId)
        if (!schema) return {}
        return readPluginSettings(pluginId, schema, scope, projectId)
      },
      notify: (request) => {
        this.notifications.emit(pluginId, request)
      },
      publish: (panelId, key, value) => {
        this.broadcast(
          createServerMessage('plugin.ui_state', {
            pluginId,
            ...(panelId ? { panelId } : {}),
            key,
            value,
          }),
        )
      },
    }
  }

  private contextFor(diagnostic: PluginDiagnostic): PluginContext {
    return this.createContext(
      {
        name: diagnostic.packageName,
        version: diagnostic.version ?? '0.0.0',
        openfox: { apiVersion: diagnostic.apiVersion },
      },
      diagnostic.source,
    )
  }

  private broadcast(message: ServerMessage): void {
    this.broadcaster?.(message)
  }

  private broadcaster: ((message: ServerMessage) => void) | undefined

  setBroadcaster(broadcaster: (message: ServerMessage) => void): void {
    this.broadcaster = broadcaster
    this.notifications.setBroadcaster(broadcaster)
  }

  private pluginsDir(): string {
    return joinPluginsDir(this.options.configDirectory)
  }

  private readDisabled(): string[] {
    const raw = getAllSettings()[DISABLED_KEY]
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
    } catch {
      return []
    }
  }

  private writeDisabled(ids: string[]): void {
    setSetting(DISABLED_KEY, JSON.stringify(ids))
  }
}

function joinPluginsDir(configDirectory: string): string {
  return `${configDirectory}/plugins`
}

function storageKey(pluginId: string, key: string): string {
  return `plugin.${pluginId}.storage.${key}`
}

function readStorageValue(pluginId: string, key: string): PluginSettingValue | undefined {
  const raw = getAllSettings()[storageKey(pluginId, key)]
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw) as PluginSettingValue
  } catch {
    return undefined
  }
}

function toServerTool(tool: PluginTool): Tool {
  return {
    name: tool.name,
    definition: {
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    },
    execute: async (args, context: ToolContext) => {
      const started = Date.now()
      try {
        const result = await tool.execute(args, {
          sessionId: context.sessionId,
          workdir: context.workdir,
          ...(context.signal ? { signal: context.signal } : {}),
        })
        return {
          success: result.success,
          ...(result.output !== undefined ? { output: result.output } : {}),
          ...(result.error !== undefined ? { error: result.error } : {}),
          durationMs: Date.now() - started,
          truncated: false,
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - started,
          truncated: false,
        }
      }
    },
  }
}

function toCommandDefinition(
  command: { id: string; name: string; prompt: string; agentMode?: string },
  pluginId: string,
): CommandDefinition {
  return {
    metadata: {
      id: command.id,
      name: command.name,
      ...(command.agentMode ? { agentMode: command.agentMode } : {}),
      pluginId,
    },
    prompt: command.prompt,
  }
}

const EVENT_HOOK_MAP: Partial<Record<string, PluginHookEvent>> = {
  'session.initialized': 'session.created',
  'task.completed': 'task.completed',
  'message.done': 'message.created',
  'tool.result': 'tool.completed',
  'criterion.updated': 'criterion.updated',
  'workflow.execution_changed': 'workflow.execution.changed',
  // OpenFox-internal events (Plugin API v2). Mapped 1:1 from the
  // TurnEvent names so plugins can correlate hook payloads with the
  // session's EventStore stream.
  'context.compacted': 'context.compacted',
  'pattern.retry': 'retry.triggered',
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Plugin RPC timed out after ${timeoutMs}ms`)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}
