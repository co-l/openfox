import type { Provider } from '../../../shared/types.js'
import { getBackendCapabilities, type Backend } from '../../llm/backend.js'
import { getModelProfile } from '../../llm/profiles.js'
import type { LLMClientWithModel } from '../../llm/client.js'
import type { ProviderTransportAdapter } from '../../../provider/index.js'
import { resolveAttachmentsInMessages } from '../../llm/client-pure.js'
import { resolveEffortForModel, resolveModeModelId } from '../../../shared/reasoning-effort.js'

export function createTransportLLMClient(
  provider: Provider,
  modelId: string,
  transport: ProviderTransportAdapter,
  reasoningEffort?: string,
): LLMClientWithModel {
  let model = modelId
  const effort = reasoningEffort
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

  const context = (resolvedEffort?: string) => {
    const configured = provider.models.find((item) => item.id === model)
    // A merged mode model sends the concrete per-level apiModelId; the base
    // model id is only a catalog projection. The resolved effort selects which
    // mode to emit.
    const send = resolveModeModelId(configured?.modes, resolvedEffort, configured?.apiModelId, model)
    return {
      providerId: provider.id,
      model: send.modelId,
      catalogModel: model,
      ...(configured?.requestBody && { requestBody: configured.requestBody }),
      ...(provider.credentialRef && { credentialRef: provider.credentialRef }),
    }
  }

  // Resolve the effort for a request: an explicit request-level effort wins,
  // then the client's (session/override) effort, then the model's configured
  // default — mirroring createLLMClient. The model's advertised preset list is
  // honored: in-list efforts pass through, out-of-list explicit efforts clamp
  // to the model default, and the raw reasoningEffortOverride is never clamped.
  const resolveEffort = (request: {
    reasoningEffort?: string
    skipClientReasoningEffort?: boolean
  }): import('../../llm/types.js').ReasoningEffort | undefined => {
    if (request.skipClientReasoningEffort) return undefined
    const configured = provider.models.find((item) => item.id === model)
    const candidate = request.reasoningEffort ?? effort
    return resolveEffortForModel({
      ...(configured?.reasoningEfforts?.length ? { reasoningEfforts: configured.reasoningEfforts } : {}),
      ...(candidate ? { candidate } : {}),
      ...(configured?.thinkingEnabled && configured.thinkingLevel ? { defaultEffort: configured.thinkingLevel } : {}),
      ...(configured?.reasoningEffortOverride ? { override: configured.reasoningEffortOverride } : {}),
    }) as import('../../llm/types.js').ReasoningEffort | undefined
  }

  // Resolve the request as delivered to the transport: attachments inlined and
  // the reasoning effort applied (explicit request effort > client effort >
  // model thinkingLevel), mirroring createLLMClient.
  const resolveRequest = async (request: import('../../llm/types.js').LLMCompletionRequest) => {
    const supportsVision = request.modelSettings?.supportsVision ?? profile.supportsVision ?? false
    const resolvedEffort = resolveEffort(request)
    const configured = provider.models.find((item) => item.id === model)
    // A merged mode model encodes the effort in its distinct provider id, so the
    // effort must not also be sent as a request-level reasoningEffort param.
    // Mirrors createConfigForProvider via resolveModeModelId.
    const send = resolveModeModelId(configured?.modes, resolvedEffort, configured?.apiModelId, model)
    return {
      request: {
        ...request,
        messages: await resolveAttachmentsInMessages(request.messages, supportsVision),
        ...(resolvedEffort && !send.suppressEffort ? { reasoningEffort: resolvedEffort } : {}),
      },
      effort: resolvedEffort,
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
    getReasoningEffort: () => resolveEffort({}),
    complete: async (request) => {
      const resolved = await resolveRequest(request)
      return transport.complete(resolved.request, context(resolved.effort))
    },
    stream: async function* (request) {
      const resolved = await resolveRequest(request)
      yield* transport.stream(resolved.request, context(resolved.effort))
    },
  }
}
