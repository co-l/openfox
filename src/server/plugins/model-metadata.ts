import type { Provider, ModelConfig } from '../../shared/types.js'
import type { PluginModelMetadataProvider, PluginModelMetadata } from '../../plugin/index.js'

let providers: PluginModelMetadataProvider[] = []

export function setPluginModelMetadataProviders(next: PluginModelMetadataProvider[]): void {
  providers = [...next]
}

export function listPluginModelMetadataProviders(): PluginModelMetadataProvider[] {
  return [...providers]
}

export async function enrichModelWithPluginMetadata(providerId: string, model: ModelConfig): Promise<ModelConfig> {
  if (providers.length === 0) return model
  const merged: PluginModelMetadata = {}
  const badges: NonNullable<PluginModelMetadata['badges']> = []
  for (const provider of providers) {
    let metadata: PluginModelMetadata | undefined
    try {
      metadata = await provider.getMetadata({ providerId, modelId: model.id, model })
    } catch {
      continue
    }
    if (!metadata) continue
    if (metadata.pricing) merged.pricing = { ...merged.pricing, ...metadata.pricing }
    if (metadata.contextWindow !== undefined) merged.contextWindow = metadata.contextWindow
    if (metadata.vision !== undefined) merged.vision = metadata.vision
    if (metadata.reasoning !== undefined) merged.reasoning = metadata.reasoning
    if (metadata.badges) badges.push(...metadata.badges)
  }
  if (badges.length > 0) merged.badges = badges
  if (Object.keys(merged).length === 0) return model
  return { ...model, pluginMetadata: merged }
}

export async function enrichProvidersWithPluginMetadata(providersToEnrich: Provider[]): Promise<Provider[]> {
  if (providers.length === 0) return providersToEnrich
  return Promise.all(
    providersToEnrich.map(async (provider) => ({
      ...provider,
      models: await Promise.all(provider.models.map((model) => enrichModelWithPluginMetadata(provider.id, model))),
    })),
  )
}
