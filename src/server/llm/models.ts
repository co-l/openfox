import { logger } from '../utils/logger.js'

export interface LlmModel {
  id: string
  object: string
  created: number
  owned_by: string
  root?: string
  max_model_len?: number
}

export interface ModelsResponse {
  object: string
  data: LlmModel[]
}

export type LlmStatus = 'connected' | 'disconnected' | 'unknown'

let cachedModel: string | null = null
let cachedModelInfo: LlmModel | null = null
let llmStatus: LlmStatus = 'unknown'
let lastFetch = 0
const CACHE_TTL_MS = 30_000 // 30 seconds

/**
 * Detect model from LLM server.
 * 
 * @param silent - If true, use debug logging instead of info/warn (for auto-detection)
 */
export async function detectModel(llmBaseUrl: string, retries = 3, silent = false): Promise<string | null> {
  // Return cached model if still fresh
  const now = Date.now()
  if (cachedModel && now - lastFetch < CACHE_TTL_MS) {
    return cachedModel
  }
  
  // Ensure URL has /v1 for OpenAI-compatible endpoint
  const url = llmBaseUrl.includes('/v1') ? `${llmBaseUrl}/models` : `${llmBaseUrl}/v1/models`
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (silent) {
        logger.debug('Fetching models from LLM server', { url, attempt })
      }
      
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
      })
      
      if (!response.ok) {
        if (silent) {
          logger.debug('Failed to fetch models from LLM server', { status: response.status, attempt })
        } else {
          logger.warn('Failed to fetch models from LLM server', { status: response.status, attempt })
        }
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 1000 * attempt))
          continue
        }
        llmStatus = 'disconnected'
        return cachedModel
      }
      
      const data = await response.json() as ModelsResponse
      
      if (data.data && data.data.length > 0) {
        // Get the first (usually only) model
        const model = data.data[0]!
        cachedModel = model.id
        cachedModelInfo = model
        llmStatus = 'connected'
        lastFetch = now
        if (silent) {
          logger.debug('Detected LLM model', { 
            model: cachedModel,
            maxLen: model.max_model_len,
            root: model.root
          })
        } else {
          logger.info('Detected LLM model', { 
            model: cachedModel,
            maxLen: model.max_model_len,
            root: model.root
          })
        }
        return cachedModel
      }
      
      if (silent) {
        logger.debug('LLM server returned empty models list')
      } else {
        logger.warn('LLM server returned empty models list')
      }
      llmStatus = 'disconnected'
      return null
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      if (silent) {
        logger.debug('Could not detect model from LLM server', { error: errMsg, attempt })
      } else {
        logger.warn('Could not detect model from LLM server', { error: errMsg, attempt })
      }
      
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * attempt))
        continue
      }
    }
  }
  
  llmStatus = 'disconnected'
  return cachedModel
}

export function getModelInfo(): LlmModel | null {
  return cachedModelInfo
}

export function getCachedModel(): string | null {
  return cachedModel
}

export function getLlmStatus(): LlmStatus {
  return llmStatus
}

export function clearModelCache(): void {
  cachedModel = null
  cachedModelInfo = null
  llmStatus = 'unknown'
  lastFetch = 0
}
