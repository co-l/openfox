import type { Provider } from '../../../shared/types.js'
import { getBackendCapabilities, type Backend } from '../../llm/backend.js'
import { getModelProfile } from '../../llm/profiles.js'
import type { LLMClientWithModel } from '../../llm/client.js'
import type { ProviderTransportAdapter } from './types.js'

export function createTransportLLMClient(
  provider: Provider,
  modelId: string,
  transport: ProviderTransportAdapter,
): LLMClientWithModel {
  let model = modelId
  let backend = provider.backend as Backend
  let profile = getModelProfile(model)
  void getBackendCapabilities(backend)

  const context = () => ({
    providerId: provider.id,
    model,
    ...(provider.credentialRef && { credentialRef: provider.credentialRef }),
  })

  return {
    getModel: () => model,
    setModel(next) {
      model = next
      profile = getModelProfile(next)
    },
    getProfile: () => profile,
    getBackend: () => backend,
    setBackend(next) {
      backend = next
    },
    complete: (request) => transport.complete(request, context()),
    stream: (request) => transport.stream(request, context()),
  }
}
