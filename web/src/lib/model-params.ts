export interface ModelParams {
  temperature?: number
  topP?: number
  topK?: number
  maxTokens?: number
}

export function buildModelParams(params: {
  temperature?: number | null
  topP?: number | null
  topK?: number | null
  maxTokens?: number | null
}): ModelParams {
  return {
    ...(params.temperature != null && { temperature: params.temperature }),
    ...(params.topP != null && { topP: params.topP }),
    ...(params.topK != null && { topK: params.topK }),
    ...(params.maxTokens != null && { maxTokens: params.maxTokens }),
  }
}
