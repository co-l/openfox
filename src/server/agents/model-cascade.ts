import type { AgentDefinition } from './types.js'
import type { LLMClientWithModel } from '../llm/client.js'
import { createCascadingLLMClient } from '../llm/model-cascade.js'
import { createRuntimeModelClient } from '../provider-manager.js'

export function resolveAgentLLMClient(agent: AgentDefinition, inherited: LLMClientWithModel): LLMClientWithModel {
  const refs = agent.metadata.modelCascade
  if (!refs?.length) return inherited
  const entries = refs.map((ref) => {
    const client = createRuntimeModelClient(ref.providerId, ref.model)
    if (!client) throw new Error(`Configured model not found: ${ref.providerId}/${ref.model}`)
    return { ...ref, client }
  })
  return createCascadingLLMClient(entries)
}
