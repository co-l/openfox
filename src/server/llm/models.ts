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

// URL-keyed cache to support multiple providers
interface ModelCacheEntry {
  model: string
  modelInfo: LlmModel
  timestamp: number
}
const modelCache = new Map<string, ModelCacheEntry>()
let llmStatus: LlmStatus = 'unknown'
let lastActiveUrl: string | null = null
const CACHE_TTL_MS = 30_000 // 30 seconds

/** Normalize URL for cache key (strip /v1 suffix) */
function getCacheKey(url: string): string {
  return url.replace(/\/v1\/?$/, '')
}

/**
 * Detect model from LLM server.
 * 
 * @param silent - If true, use debug logging instead of info/warn (for auto-detection)
 */
export async function detectModel(llmBaseUrl: string, retries = 3, silent = false): Promise<string | null> {
  const cacheKey = getCacheKey(llmBaseUrl)
  
  // Return cached model if still fresh for this URL
  const now = Date.now()
  const cached = modelCache.get(cacheKey)
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    lastActiveUrl = cacheKey
    llmStatus = 'connected'
    return cached.model
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
        return cached?.model ?? null
      }
      
      const data = await response.json() as ModelsResponse
      
      if (data.data && data.data.length > 0) {
        // Get the first (usually only) model
        const modelData = data.data[0]!
        const modelId = modelData.id
        
        // Cache with URL as key
        modelCache.set(cacheKey, {
          model: modelId,
          modelInfo: modelData,
          timestamp: now,
        })
        lastActiveUrl = cacheKey
        llmStatus = 'connected'
        
        if (silent) {
          logger.debug('Detected LLM model', { 
            model: modelId,
            maxLen: modelData.max_model_len,
            root: modelData.root
          })
        } else {
          logger.info('Detected LLM model', { 
            model: modelId,
            maxLen: modelData.max_model_len,
            root: modelData.root
          })
        }
        return modelId
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
  return cached?.model ?? null
}

export function getModelInfo(): LlmModel | null {
  if (!lastActiveUrl) return null
  return modelCache.get(lastActiveUrl)?.modelInfo ?? null
}

export function getCachedModel(): string | null {
  if (!lastActiveUrl) return null
  return modelCache.get(lastActiveUrl)?.model ?? null
}

export function getLlmStatus(): LlmStatus {
  return llmStatus
}

export function setLlmStatus(status: LlmStatus): void {
  llmStatus = status
}

/**
 * Clear model cache for a specific URL, or all if no URL provided.
 */
export function clearModelCache(url?: string): void {
  if (url) {
    modelCache.delete(getCacheKey(url))
  } else {
    modelCache.clear()
  }
  llmStatus = 'unknown'
}
