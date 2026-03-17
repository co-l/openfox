import { logger } from '../utils/logger.js'

export interface VllmModel {
  id: string
  object: string
  created: number
  owned_by: string
  root?: string
  max_model_len?: number
}

export interface ModelsResponse {
  object: string
  data: VllmModel[]
}

export type VllmStatus = 'connected' | 'disconnected' | 'unknown'

let cachedModel: string | null = null
let cachedModelInfo: VllmModel | null = null
let vllmStatus: VllmStatus = 'unknown'
let lastFetch = 0
const CACHE_TTL_MS = 30_000 // 30 seconds

export async function detectModel(vllmBaseUrl: string, retries = 3): Promise<string | null> {
  // Return cached model if still fresh
  const now = Date.now()
  if (cachedModel && now - lastFetch < CACHE_TTL_MS) {
    return cachedModel
  }
  
  const url = `${vllmBaseUrl}/models`
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.debug('Fetching models from vLLM', { url, attempt })
      
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
      })
      
      if (!response.ok) {
        logger.warn('Failed to fetch models from vLLM', { status: response.status, attempt })
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 1000 * attempt))
          continue
        }
        vllmStatus = 'disconnected'
        return cachedModel
      }
      
      const data = await response.json() as ModelsResponse
      
      if (data.data && data.data.length > 0) {
        // Get the first (usually only) model
        const model = data.data[0]!
        cachedModel = model.id
        cachedModelInfo = model
        vllmStatus = 'connected'
        lastFetch = now
        logger.info('Detected vLLM model', { 
          model: cachedModel,
          maxLen: model.max_model_len,
          root: model.root
        })
        return cachedModel
      }
      
      logger.warn('vLLM returned empty models list')
      vllmStatus = 'disconnected'
      return null
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      logger.warn('Could not detect model from vLLM', { error: errMsg, attempt })
      
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * attempt))
        continue
      }
    }
  }
  
  vllmStatus = 'disconnected'
  return cachedModel
}

export function getModelInfo(): VllmModel | null {
  return cachedModelInfo
}

export function getCachedModel(): string | null {
  return cachedModel
}

export function getVllmStatus(): VllmStatus {
  return vllmStatus
}

export function clearModelCache(): void {
  cachedModel = null
  cachedModelInfo = null
  vllmStatus = 'unknown'
  lastFetch = 0
}
