import type { Provider } from '../../../shared/types.js'
import type {
  ProviderAuthAdapter,
  ProviderPluginRegistry,
  ProviderPluginRuntime,
  ProviderPreset,
  ProviderTransportAdapter,
} from '../../../provider/index.js'

export class ProviderRegistry implements ProviderPluginRegistry {
  private readonly authAdapters = new Map<string, ProviderAuthAdapter>()
  private readonly transportAdapters = new Map<string, ProviderTransportAdapter>()
  private readonly presets = new Map<string, ProviderPreset>()

  constructor(readonly runtime: ProviderPluginRuntime) {}

  registerAuth(adapter: ProviderAuthAdapter): void {
    this.register(this.authAdapters, adapter.id, adapter, 'auth adapter')
  }

  registerTransport(adapter: ProviderTransportAdapter): void {
    this.register(this.transportAdapters, adapter.id, adapter, 'transport adapter')
  }

  registerPreset(preset: ProviderPreset): void {
    this.register(this.presets, preset.id, preset, 'preset')
  }

  getAuth(id?: string): ProviderAuthAdapter | undefined {
    return id ? this.authAdapters.get(id) : undefined
  }

  getTransport(id?: string): ProviderTransportAdapter | undefined {
    return id ? this.transportAdapters.get(id) : undefined
  }

  getPresets(): ProviderPreset[] {
    return [...this.presets.values()]
  }

  resolveProvider(provider: Provider): Provider {
    if (!provider.preset) return provider
    const preset = this.presets.get(provider.preset)
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

  listAuthAdapters(): Array<{ id: string }> {
    return [...this.authAdapters.keys()].map((id) => ({ id }))
  }

  listTransportAdapters(): Array<{ id: string }> {
    return [...this.transportAdapters.keys()].map((id) => ({ id }))
  }

  private register<T>(map: Map<string, T>, id: string, value: T, kind: string): void {
    if (!id.trim()) throw new Error(`Provider ${kind} id cannot be empty`)
    if (map.has(id)) {
      map.delete(id)
    }
    map.set(id, value)
  }
}
