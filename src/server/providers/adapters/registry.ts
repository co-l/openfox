import type { ProviderAuthAdapter, ProviderTransportAdapter } from './types.js'

export class ProviderAdapterRegistry {
  private readonly authAdapters = new Map<string, ProviderAuthAdapter>()
  private readonly transportAdapters = new Map<string, ProviderTransportAdapter>()

  registerAuth(adapter: ProviderAuthAdapter): void {
    this.assertUnique(this.authAdapters, adapter.id, 'auth')
    this.authAdapters.set(adapter.id, adapter)
  }

  registerTransport(adapter: ProviderTransportAdapter): void {
    this.assertUnique(this.transportAdapters, adapter.id, 'transport')
    this.transportAdapters.set(adapter.id, adapter)
  }

  getAuth(id?: string): ProviderAuthAdapter | undefined {
    return id ? this.authAdapters.get(id) : undefined
  }

  getTransport(id?: string): ProviderTransportAdapter | undefined {
    return id ? this.transportAdapters.get(id) : undefined
  }

  private assertUnique<T>(registry: Map<string, T>, id: string, kind: string): void {
    if (!id.trim()) throw new Error(`Provider ${kind} adapter id cannot be empty`)
    if (registry.has(id)) throw new Error(`Provider ${kind} adapter already registered: ${id}`)
  }
}
