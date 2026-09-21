import type { Provider } from '../../shared/types.js'
import type {
  ProviderAuthAdapter,
  ProviderPluginRegistry,
  ProviderPluginRuntime,
  ProviderPreset,
  ProviderTransportAdapter,
} from '../../provider/index.js'
import type {
  PluginCommand,
  PluginContext,
  PluginHookEvent,
  PluginHookHandler,
  PluginModelMetadataProvider,
  PluginNotificationRequest,
  PluginRegistry as PluginRegistryContract,
  PluginRpcHandler,
  PluginSettingsSchema,
  PluginSettingsTab,
  PluginSkillSource,
  PluginTool,
  PluginTransitionContext,
} from '../../plugin/index.js'
import type {
  PluginContributionSummary,
  PluginUiAction,
  PluginUiBadge,
  PluginUiComponent,
  PluginUiContributions,
  PluginUiOverride,
  PluginUiPanel,
  PluginUiSection,
} from '../../shared/plugin.js'
import { EMPTY_PLUGIN_CONTRIBUTIONS } from '../../shared/plugin.js'
import { registerPluginTransitionHandler, unregisterPluginTransitionHandlers } from './transition-handlers.js'

type Kind =
  | 'auth'
  | 'transport'
  | 'preset'
  | 'modelMetadata'
  | 'tool'
  | 'command'
  | 'skillSource'
  | 'hook'
  | 'rpc'
  | 'transition'
  | 'settings'
  | 'uiAction'
  | 'uiBadge'
  | 'uiPanel'
  | 'settingsTab'
  | 'uiComponent'
  | 'uiOverride'
  | 'asset'

interface Owned<T> {
  pluginId: string
  value: T
}

const UNKNOWN_PLUGIN = 'unknown'

export class PluginRegistry implements ProviderPluginRegistry, PluginRegistryContract {
  private readonly entries = new Map<Kind, Map<string, Owned<unknown>>>()
  private readonly conflicts: string[] = []
  private readonly hookHandlers = new Map<PluginHookEvent, Owned<PluginHookHandler>[]>()
  private readonly assets = new Map<string, Set<string>>()
  private reservedToolNames = new Set<string>()
  private currentPluginId: string | undefined
  private currentContext: PluginContext | undefined

  constructor(readonly runtime: ProviderPluginRuntime) {}

  beginPlugin(pluginId: string, context: PluginContext): void {
    this.currentPluginId = pluginId
    this.currentContext = context
  }

  endPlugin(): void {
    this.currentPluginId = undefined
    this.currentContext = undefined
  }

  get context(): PluginContext {
    if (!this.currentContext) throw new Error('Plugin context is only available while a plugin is registering')
    return this.currentContext
  }

  setReservedToolNames(names: Set<string>): void {
    this.reservedToolNames = names
  }

  getConflicts(): string[] {
    return [...this.conflicts]
  }

  clearConflicts(): void {
    this.conflicts.length = 0
  }

  registerAuth(adapter: ProviderAuthAdapter): void {
    if (!this.register('auth', adapter.id, adapter)) return
  }

  registerTransport(adapter: ProviderTransportAdapter): void {
    this.register('transport', adapter.id, adapter)
  }

  registerPreset(preset: ProviderPreset): void {
    this.register('preset', preset.id, preset)
  }

  registerModelMetadataProvider(provider: PluginModelMetadataProvider): void {
    this.register('modelMetadata', provider.id, provider)
  }

  registerTool(tool: PluginTool): void {
    if (this.reservedToolNames.has(tool.name)) {
      this.conflicts.push(`Plugin tool '${tool.name}' collides with a built-in tool and was rejected`)
      return
    }
    this.register('tool', tool.name, tool)
  }

  registerCommand(command: PluginCommand): void {
    this.register('command', command.id, command)
  }

  registerSkillSource(source: PluginSkillSource): void {
    this.register('skillSource', source.id, source)
  }

  registerSettings(schema: PluginSettingsSchema): void {
    this.register('settings', this.currentPluginId ?? UNKNOWN_PLUGIN, schema)
  }

  registerUiAction(action: PluginUiAction): void {
    this.register('uiAction', action.id, action)
  }

  registerUiBadge(badge: PluginUiBadge): void {
    this.register('uiBadge', badge.id, badge)
  }

  registerUiPanel(panel: PluginUiPanel): void {
    this.register('uiPanel', panel.id, panel)
  }

  registerSettingsTab(tab: PluginSettingsTab): void {
    this.register('settingsTab', tab.id, tab)
  }

  registerUiComponent(component: PluginUiComponent): void {
    this.register('uiComponent', component.id, component)
  }

  registerUiOverride(override: PluginUiOverride): void {
    this.register('uiOverride', override.id, override)
  }

  registerHook(event: PluginHookEvent, handler: PluginHookHandler): void {
    const pluginId = this.currentPluginId ?? UNKNOWN_PLUGIN
    const list = this.hookHandlers.get(event) ?? []
    list.push({ pluginId, value: handler })
    this.hookHandlers.set(event, list)
  }

  registerTransitionHandler(
    name: string,
    handler: (context: PluginTransitionContext) => boolean | Promise<boolean>,
  ): void {
    const pluginId = this.currentPluginId ?? UNKNOWN_PLUGIN
    registerPluginTransitionHandler(pluginId, name, handler)
    this.register('transition', `${pluginId}:${name}`, handler)
  }

  registerRpc(method: string, handler: PluginRpcHandler): void {
    this.register('rpc', method, handler)
  }

  registerAsset(relativePath: string): void {
    const pluginId = this.currentPluginId ?? UNKNOWN_PLUGIN
    const set = this.assets.get(pluginId) ?? new Set<string>()
    set.add(relativePath)
    this.assets.set(pluginId, set)
  }

  notify(request: PluginNotificationRequest): void {
    this.context.notify(request)
  }

  getAuth(id?: string): ProviderAuthAdapter | undefined {
    return id ? (this.get<ProviderAuthAdapter>('auth', id) as ProviderAuthAdapter | undefined) : undefined
  }

  getTransport(id?: string): ProviderTransportAdapter | undefined {
    return id
      ? (this.get<ProviderTransportAdapter>('transport', id) as ProviderTransportAdapter | undefined)
      : undefined
  }

  getPresets(): ProviderPreset[] {
    return this.list<ProviderPreset>('preset')
  }

  getModelMetadataProviders(): PluginModelMetadataProvider[] {
    return this.list<PluginModelMetadataProvider>('modelMetadata')
  }

  getTools(): PluginTool[] {
    return this.list<PluginTool>('tool')
  }

  getCommands(): PluginCommand[] {
    return this.list<PluginCommand>('command')
  }

  getOwnedCommands(): { pluginId: string; command: PluginCommand }[] {
    return this.listOwned<PluginCommand>('command').map((entry) => ({
      pluginId: entry.pluginId,
      command: entry.value,
    }))
  }

  getOwnedTools(): { pluginId: string; tool: PluginTool }[] {
    return this.listOwned<PluginTool>('tool').map((entry) => ({ pluginId: entry.pluginId, tool: entry.value }))
  }

  getSkillSources(): PluginSkillSource[] {
    return this.list<PluginSkillSource>('skillSource')
  }

  getSettingsSchema(pluginId: string): PluginSettingsSchema | undefined {
    return this.get<PluginSettingsSchema>('settings', pluginId)
  }

  getUiContributions(): PluginUiContributions {
    return {
      actions: this.listOwned<PluginUiAction>('uiAction').map((entry) => ({
        ...entry.value,
        pluginId: entry.pluginId,
      })),
      badges: this.listOwned<PluginUiBadge>('uiBadge').map((entry) => ({ ...entry.value, pluginId: entry.pluginId })),
      panels: this.listOwned<PluginUiPanel>('uiPanel').map((entry) => ({ ...entry.value, pluginId: entry.pluginId })),
      sections: this.listSections(),
      settingsTabs: this.listOwned<PluginSettingsTab>('settingsTab').map((entry) => ({
        ...entry.value,
        pluginId: entry.pluginId,
      })),
      components: this.listOwned<PluginUiComponent>('uiComponent').map((entry) => ({
        ...entry.value,
        pluginId: entry.pluginId,
      })),
      overrides: this.listOwned<PluginUiOverride>('uiOverride').map((entry) => ({
        ...entry.value,
        pluginId: entry.pluginId,
      })),
    }
  }

  getHookHandlers(event: PluginHookEvent): Owned<PluginHookHandler>[] {
    return [...(this.hookHandlers.get(event) ?? [])]
  }

  getRpcHandler(pluginId: string, method: string): PluginRpcHandler | undefined {
    const entry = this.entries.get('rpc')?.get(method)
    return entry && entry.pluginId === pluginId ? (entry.value as PluginRpcHandler) : undefined
  }

  getAssets(pluginId: string): string[] {
    return [...(this.assets.get(pluginId) ?? [])]
  }

  getPluginIdFor(kind: string, id: string): string | undefined {
    return this.entries.get(kind as Kind)?.get(id)?.pluginId
  }

  listContributions(pluginId: string): { kind: string; id: string }[] {
    const result: { kind: string; id: string }[] = []
    for (const [kind, map] of this.entries) {
      for (const [id, entry] of map) {
        if (entry.pluginId === pluginId) result.push({ kind, id })
      }
    }
    return result
  }

  getContributionSummary(pluginId: string): PluginContributionSummary {
    const count = (kind: Kind): number => this.listFor(pluginId, kind).length
    return {
      ...EMPTY_PLUGIN_CONTRIBUTIONS,
      presets: count('preset'),
      authAdapters: count('auth'),
      transportAdapters: count('transport'),
      modelMetadataProviders: count('modelMetadata'),
      tools: count('tool'),
      commands: count('command'),
      skillSources: count('skillSource'),
      hooks: [...this.hookHandlers.values()].flat().filter((h) => h.pluginId === pluginId).length,
      rpcMethods: count('rpc'),
      transitions: count('transition'),
      settingsFields: this.getSettingsSchema(pluginId)?.fields.length ?? 0,
      uiActions: count('uiAction'),
      uiBadges: count('uiBadge'),
      uiPanels: count('uiPanel'),
      settingsTabs: count('settingsTab'),
      uiComponents: count('uiComponent'),
      uiOverrides: count('uiOverride'),
    }
  }

  removePlugin(pluginId: string): void {
    for (const [, map] of this.entries) {
      for (const [id, entry] of map) {
        if (entry.pluginId === pluginId) map.delete(id)
      }
    }
    for (const [event, list] of this.hookHandlers) {
      this.hookHandlers.set(
        event,
        list.filter((entry) => entry.pluginId !== pluginId),
      )
    }
    this.assets.delete(pluginId)
    unregisterPluginTransitionHandlers(pluginId)
  }

  listAuthAdapters(): Array<{ id: string }> {
    return [...(this.entries.get('auth')?.keys() ?? [])].map((id) => ({ id }))
  }

  listTransportAdapters(): Array<{ id: string }> {
    return [...(this.entries.get('transport')?.keys() ?? [])].map((id) => ({ id }))
  }

  resolveProvider(provider: Provider): Provider {
    if (!provider.preset) return provider
    const preset = this.getPresets().find((candidate) => candidate.id === provider.preset)
    if (!preset) return provider

    return {
      ...provider,
      name: provider.name === provider.id ? (preset.defaults.name ?? preset.name) : provider.name,
      url: provider.url || preset.defaults.url,
      backend: provider.backend === 'unknown' ? (preset.defaults.backend as Provider['backend']) : provider.backend,
      models: provider.models.length > 0 ? provider.models : (preset.defaults.models ?? []),
      ...((provider.authAdapter ?? preset.authAdapter)
        ? { authAdapter: provider.authAdapter ?? preset.authAdapter }
        : {}),
      ...((provider.transportAdapter ?? preset.transportAdapter)
        ? { transportAdapter: provider.transportAdapter ?? preset.transportAdapter }
        : {}),
    }
  }

  resolveProviders(providers: Provider[]): Provider[] {
    return providers.map((provider) => this.resolveProvider(provider))
  }

  private listSections(): PluginUiSection[] {
    const sections: PluginUiSection[] = []
    for (const [pluginId, entry] of this.entries.get('settings') ?? []) {
      sections.push({
        id: pluginId,
        pluginId,
        title: { en: 'Settings', fr: 'Paramètres' },
        schema: entry.value as PluginSettingsSchema,
      })
    }
    return sections
  }

  private register<T>(kind: Kind, id: string, value: T): boolean {
    if (!id.trim()) throw new Error(`Plugin ${kind} id cannot be empty`)
    const pluginId = this.currentPluginId ?? UNKNOWN_PLUGIN
    const map = this.entries.get(kind) ?? new Map<string, Owned<unknown>>()
    this.entries.set(kind, map)

    const existing = map.get(id)
    if (existing && this.currentPluginId !== undefined && existing.pluginId !== pluginId) {
      this.conflicts.push(`Plugin ${kind} '${id}' is already registered by '${existing.pluginId}'`)
      return false
    }
    map.set(id, { pluginId, value })
    return true
  }

  private get<T>(kind: Kind, id: string): T | undefined {
    return this.entries.get(kind)?.get(id)?.value as T | undefined
  }

  private list<T>(kind: Kind): T[] {
    return [...(this.entries.get(kind)?.values() ?? [])].map((entry) => entry.value as T)
  }

  private listOwned<T>(kind: Kind): Owned<T>[] {
    return [...(this.entries.get(kind)?.values() ?? [])].map((entry) => ({
      pluginId: entry.pluginId,
      value: entry.value as T,
    }))
  }

  private listFor(pluginId: string, kind: Kind): unknown[] {
    return [...(this.entries.get(kind)?.values() ?? [])]
      .filter((entry) => entry.pluginId === pluginId)
      .map((entry) => entry.value)
  }
}
