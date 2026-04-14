/**
 * LLM Backend detection and capabilities.
 * Supports vLLM, SGLang, Ollama, and llama.cpp inference engines.
 */

import { logger } from '../utils/logger.js'

export type Backend = 'vllm' | 'sglang' | 'ollama' | 'llamacpp' | 'opencode-go' | 'unknown'

export interface BackendCapabilities {
  /** Whether the backend returns reasoning_content as a separate field (vLLM/SGLang) */
  supportsReasoningField: boolean
  /** Whether chat_template_kwargs with enable_thinking works (vLLM/SGLang) */
  supportsChatTemplateKwargs: boolean
  /** Whether top_k parameter is supported in OpenAI-compatible mode */
  supportsTopK: boolean
}

const BACKEND_CAPABILITIES: Record<Backend, BackendCapabilities> = {
  vllm: {
    supportsReasoningField: true,
    supportsChatTemplateKwargs: true,
    supportsTopK: true,
  },
  sglang: {
    supportsReasoningField: true,
    supportsChatTemplateKwargs: true,
    supportsTopK: true,
  },
  ollama: {
    supportsReasoningField: false,
    supportsChatTemplateKwargs: false,
    supportsTopK: false,
  },
  llamacpp: {
    supportsReasoningField: false,
    supportsChatTemplateKwargs: false,
    supportsTopK: true,
  },
  'opencode-go': {
    supportsReasoningField: false,
    supportsChatTemplateKwargs: false,
    supportsTopK: true,
  },
  unknown: {
    // Assume vLLM-like for unknown backends
    supportsReasoningField: true,
    supportsChatTemplateKwargs: true,
    supportsTopK: true,
  },
}

export function getBackendCapabilities(backend: Backend): BackendCapabilities {
  return BACKEND_CAPABILITIES[backend]
}

/**
 * Detect which LLM backend is running at the given URL.
 * 
 * Detection order:
 * 1. Ollama: /api/tags endpoint exists
 * 2. llama.cpp: /health returns slots_idle/slots_processing
 * 3. SGLang: /get_model_info endpoint exists
 * 4. vLLM: /v1/models works (default for OpenAI-compatible)
 * 5. unknown: nothing responds
 * 
 * @param silent - If true, use debug logging instead of info/warn (for auto-detection)
 */
export async function detectBackend(
  baseUrl: string,
  explicitBackend?: Backend,
  silent = false
): Promise<Backend> {
  // Allow explicit override
  if (explicitBackend && explicitBackend !== 'unknown') {
    if (silent) {
      logger.debug('Using explicit backend', { backend: explicitBackend })
    } else {
      logger.info('Using explicit backend', { backend: explicitBackend })
    }
    return explicitBackend
  }

  // Normalize URL - remove /v1 suffix if present for probing
  const probeUrl = baseUrl.replace(/\/v1\/?$/, '')

  try {
    // 1. Check for Ollama
    if (await probeOllama(probeUrl)) {
      if (silent) {
        logger.debug('Detected Ollama backend', { url: probeUrl })
      } else {
        logger.info('Detected Ollama backend', { url: probeUrl })
      }
      return 'ollama'
    }

    // 2. Check for llama.cpp
    if (await probeLlamaCpp(probeUrl)) {
      if (silent) {
        logger.debug('Detected llama.cpp backend', { url: probeUrl })
      } else {
        logger.info('Detected llama.cpp backend', { url: probeUrl })
      }
      return 'llamacpp'
    }

    // 3. Check for SGLang
    if (await probeSGLang(probeUrl)) {
      if (silent) {
        logger.debug('Detected SGLang backend', { url: probeUrl })
      } else {
        logger.info('Detected SGLang backend', { url: probeUrl })
      }
      return 'sglang'
    }

    // 4. Check for vLLM (or any OpenAI-compatible)
    if (await probeOpenAI(baseUrl)) {
      if (silent) {
        logger.debug('Detected vLLM backend (OpenAI-compatible)', { url: baseUrl })
      } else {
        logger.info('Detected vLLM backend (OpenAI-compatible)', { url: baseUrl })
      }
      return 'vllm'
    }

    if (silent) {
      logger.debug('Could not detect backend, using unknown', { url: baseUrl })
    } else {
      logger.warn('Could not detect backend, using unknown', { url: baseUrl })
    }
    return 'unknown'
  } catch (error) {
    if (silent) {
      logger.debug('Backend detection failed', { 
        url: baseUrl, 
        error: error instanceof Error ? error.message : String(error) 
      })
    } else {
      logger.warn('Backend detection failed', { 
        url: baseUrl, 
        error: error instanceof Error ? error.message : String(error) 
      })
    }
    return 'unknown'
  }
}

async function probeOllama(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

async function probeLlamaCpp(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return false
    
    const data = await response.json() as Record<string, unknown>
    // llama.cpp health returns slots_idle and slots_processing
    return 'slots_idle' in data || 'slots_processing' in data
  } catch {
    return false
  }
}

async function probeSGLang(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/get_model_info`, {
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

async function probeOpenAI(baseUrl: string): Promise<boolean> {
  try {
    // Ensure URL has /v1 for OpenAI-compatible endpoint
    const url = baseUrl.includes('/v1') ? baseUrl : `${baseUrl}/v1`
    const response = await fetch(`${url}/models`, {
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

/** Display name for each backend */
export function getBackendDisplayName(backend: Backend): string {
  switch (backend) {
    case 'vllm': return 'vLLM'
    case 'sglang': return 'SGLang'
    case 'ollama': return 'Ollama'
    case 'llamacpp': return 'llama.cpp'
    case 'opencode-go': return 'OpenCode Go'
    case 'unknown': return 'Unknown'
  }
}
