/**
 * LLM Backend capabilities and display names.
 * Supports vLLM, SGLang, Ollama, and llama.cpp inference engines.
 */

export type Backend =
  'vllm' | 'sglang' | 'ollama' | 'llamacpp' | 'lmstudio' | 'opencode-go' | 'openai' | 'anthropic' | 'unknown'

export interface BackendCapabilities {
  /** Whether chat_template_kwargs with enable_thinking works (vLLM/SGLang) */
  supportsChatTemplateKwargs: boolean
  /** Whether top_k parameter is supported in OpenAI-compatible mode */
  supportsTopK: boolean
  /** Whether the client uses Ollama's native /api/chat (consumes num_ctx) */
  supportsNumCtx: boolean
  /**
   * Whether reasoning effort must be routed through chat_template_kwargs
   * (llama.cpp only populates Jinja template variables from kwargs; a
   * top-level reasoning_effort body field is silently ignored).
   */
  routesEffortViaChatTemplateKwargs: boolean
}

const BACKEND_CAPABILITIES: Record<Backend, BackendCapabilities> = {
  vllm: {
    supportsChatTemplateKwargs: true,
    supportsTopK: true,
    supportsNumCtx: false,
    routesEffortViaChatTemplateKwargs: false,
  },
  sglang: {
    supportsChatTemplateKwargs: true,
    supportsTopK: true,
    supportsNumCtx: false,
    routesEffortViaChatTemplateKwargs: false,
  },
  openai: {
    supportsChatTemplateKwargs: false,
    supportsTopK: false,
    supportsNumCtx: false,
    routesEffortViaChatTemplateKwargs: false,
  },
  anthropic: {
    supportsChatTemplateKwargs: false,
    supportsTopK: false,
    supportsNumCtx: false,
    routesEffortViaChatTemplateKwargs: false,
  },
  ollama: {
    supportsChatTemplateKwargs: false,
    supportsTopK: false,
    supportsNumCtx: true,
    routesEffortViaChatTemplateKwargs: false,
  },
  llamacpp: {
    supportsChatTemplateKwargs: false,
    supportsTopK: true,
    supportsNumCtx: false,
    routesEffortViaChatTemplateKwargs: true,
  },
  lmstudio: {
    supportsChatTemplateKwargs: false,
    supportsTopK: true,
    supportsNumCtx: false,
    routesEffortViaChatTemplateKwargs: false,
  },
  'opencode-go': {
    supportsChatTemplateKwargs: false,
    supportsTopK: true,
    supportsNumCtx: false,
    routesEffortViaChatTemplateKwargs: false,
  },
  unknown: {
    supportsChatTemplateKwargs: true,
    supportsTopK: true,
    supportsNumCtx: false,
    routesEffortViaChatTemplateKwargs: false,
  },
}

export function getBackendCapabilities(backend: Backend): BackendCapabilities {
  return BACKEND_CAPABILITIES[backend]
}

/** Display name for each backend */
export function getBackendDisplayName(backend: Backend): string {
  switch (backend) {
    case 'vllm':
      return 'vLLM'
    case 'sglang':
      return 'SGLang'
    case 'ollama':
      return 'Ollama'
    case 'llamacpp':
      return 'llama.cpp'
    case 'lmstudio':
      return 'LM Studio'
    case 'opencode-go':
      return 'OpenCode Go'
    case 'openai':
      return 'OpenAI'
    case 'anthropic':
      return 'Anthropic'
    case 'unknown':
      return 'Other'
  }
}
