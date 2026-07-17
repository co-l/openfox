import type { Provider } from '../../../shared/types.js'
import { getBackendCapabilities, type Backend } from '../../llm/backend.js'
import { getModelProfile } from '../../llm/profiles.js'
import type { LLMClientWithModel } from '../../llm/client.js'
import type { ProviderTransportAdapter } from '../../../provider/index.js'
import { resolveAttachmentsInMessages } from '../../llm/client-pure.js'

export function createTransportLLMClient(
  provider: Provider,
  modelId: string,
  transport: ProviderTransportAdapter,
): LLMClientWithModel {
  let model = modelId
  let backend = provider.backend as Backend
  const profileFor = (id: string) => {
    const base = getModelProfile(id)
    const configured = provider.models.find((item) => item.id === id)
    return {
      ...base,
      ...(configured?.defaultTemperature !== undefined && { temperature: configured.defaultTemperature }),
      ...(configured?.defaultTopP !== undefined && { topP: configured.defaultTopP }),
      ...(configured?.defaultTopK !== undefined && { topK: configured.defaultTopK }),
      ...(configured?.defaultMaxTokens !== undefined && { defaultMaxTokens: configured.defaultMaxTokens }),
      ...(configured?.supportsVision !== undefined && { supportsVision: configured.supportsVision }),
    }
  }
  let profile = profileFor(model)
  void getBackendCapabilities(backend)

  const context = () => {
    const configured = provider.models.find((item) => item.id === model)
    return {
      providerId: provider.id,
      model: configured?.apiModelId ?? model,
      catalogModel: model,
      ...(configured?.requestBody && { requestBody: configured.requestBody }),
      ...(provider.credentialRef && { credentialRef: provider.credentialRef }),
    }
  }

  return {
    getModel: () => model,
    setModel(next) {
      model = next
      profile = profileFor(next)
    },
    getProfile: () => profile,
    getBackend: () => backend,
    setBackend(next) {
      backend = next
    },
    complete: async (request) => {
      const supportsVision = request.modelSettings?.supportsVision ?? profile.supportsVision ?? false
      const resolved = { ...request, messages: await resolveAttachmentsInMessages(request.messages, supportsVision) }
      return transport.complete(resolved, context())
    },
    stream: async function* (request) {
      const supportsVision = request.modelSettings?.supportsVision ?? profile.supportsVision ?? false
      const resolved = { ...request, messages: await resolveAttachmentsInMessages(request.messages, supportsVision) }
      yield* transport.stream(resolved, context())
    },
  }
}
