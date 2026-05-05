export interface TurnStats {
  model: string
  mode: string
  totalTime: number
  prefillTokens: number
  generationTokens: number
  llmCalls?: Array<{
    temperature?: number
    topP?: number
    topK?: number
    maxTokens?: number
    promptTokens: number
    completionTokens: number
    ttft: number
    completionTime: number
  }>
}
