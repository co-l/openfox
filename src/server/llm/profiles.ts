/**
 * Model-specific configuration profiles.
 * Different models have different optimal settings and capabilities.
 */

export interface ModelProfile {
  /** Display name for the model */
  name: string

  /** Sampling parameters */
  temperature: number
  topP: number
  topK?: number

  /** Max tokens to generate if not specified */
  defaultMaxTokens: number

  /** Whether the model supports vision/images */
  supportsVision: boolean

  /**
   * Preferred API protocol for the model family (e.g. gpt-5 → responses,
   * where tools + reasoning effort work together). Used to route the request
   * on backends that speak that protocol (currently `openai`).
   */
  apiProtocol?: 'chat-completions' | 'responses'
}

/** Default profile for unknown models */
const DEFAULT_PROFILE: ModelProfile = {
  name: 'default',
  temperature: 0.7,
  topP: 0.9,
  defaultMaxTokens: 16384,
  supportsVision: true,
}

/** Profile for mock LLM testing */
const MOCK_PROFILE: ModelProfile = {
  name: 'mock',
  temperature: 0.7,
  topP: 0.9,
  defaultMaxTokens: 1024,
  supportsVision: false,
}

/**
 * Model profiles indexed by model name patterns.
 * Patterns are matched against the model name (case-insensitive, partial match).
 */
const MODEL_PROFILES: Array<{ pattern: string; profile: ModelProfile }> = [
  {
    pattern: 'mistral',
    profile: {
      name: 'Mistral',
      temperature: 0.7,
      topP: 0.9,
      defaultMaxTokens: 16384,
      supportsVision: false,
    },
  },
  {
    pattern: 'qwen3-coder-next',
    profile: {
      name: 'Qwen3-Coder-Next',
      // Per Qwen docs: "temperature=1.0, top_p=0.95, top_k=40"
      temperature: 1.0,
      topP: 0.95,
      topK: 40,
      // "This model supports only non-thinking mode and does not generate <think></think> blocks"
      defaultMaxTokens: 16384,
      supportsVision: false,
    },
  },
  {
    pattern: 'qwen3.8',
    profile: {
      name: 'Qwen3.8',
      // Per Qwen3.8-27B model card (thinking mode — the default for coding
      // sessions): "temperature=1.0, top_p=0.95, top_k=20"
      temperature: 1.0,
      topP: 0.95,
      topK: 20,
      // Qwen3.8 over-thinks; keep a large output budget (clamped to the
      // model's context window at request time).
      defaultMaxTokens: 50000,
      supportsVision: true,
    },
  },
  {
    pattern: 'qwen3',
    profile: {
      name: 'Qwen3',
      temperature: 0.7,
      topP: 0.9,
      defaultMaxTokens: 16384,
      supportsVision: false,
    },
  },
  {
    pattern: 'qwen3-vl',
    profile: {
      name: 'Qwen3-VL',
      temperature: 0.7,
      topP: 0.9,
      defaultMaxTokens: 16384,
      supportsVision: true,
    },
  },
  {
    pattern: 'deepseek',
    profile: {
      name: 'DeepSeek',
      // Per DeepSeek API docs: default temperature is 1.0
      temperature: 1,
      topP: 0.95,
      defaultMaxTokens: 16384,
      supportsVision: false,
    },
  },
  {
    pattern: 'minimax-m2.5',
    profile: {
      name: 'MiniMax-M2.5',
      temperature: 1,
      topP: 0.95,
      topK: 40,
      defaultMaxTokens: 16384,
      supportsVision: false,
    },
  },
  {
    pattern: 'minimax-m2.7',
    profile: {
      name: 'MiniMax-M2.7',
      temperature: 1,
      topP: 0.95,
      topK: 40,
      defaultMaxTokens: 16384,
      supportsVision: false,
    },
  },
  {
    pattern: 'minimax',
    profile: {
      name: 'MiniMax',
      temperature: 1,
      topP: 0.95,
      topK: 40,
      defaultMaxTokens: 16384,
      supportsVision: false,
    },
  },
  {
    pattern: 'minimax-m3',
    profile: {
      name: 'MiniMax-M3',
      temperature: 1,
      topP: 0.95,
      topK: 40,
      defaultMaxTokens: 16384,
      supportsVision: true,
    },
  },
  {
    pattern: 'llava',
    profile: {
      name: 'LLaVA',
      temperature: 0.7,
      topP: 0.9,
      defaultMaxTokens: 16384,
      supportsVision: true,
    },
  },
  {
    pattern: 'llama',
    profile: {
      name: 'Llama',
      temperature: 0.7,
      topP: 0.9,
      defaultMaxTokens: 16384,
      supportsVision: false,
    },
  },
  {
    pattern: 'claude',
    profile: {
      name: 'Claude',
      temperature: 0.7,
      topP: 0.9,
      defaultMaxTokens: 16384,
      supportsVision: false,
    },
  },
  {
    pattern: 'gpt-5',
    profile: {
      name: 'GPT-5',
      // OpenAI's gpt-5 family only accepts temperature = 1 (and top_p = 1);
      // any other value is rejected with a 400.
      temperature: 1.0,
      topP: 1.0,
      defaultMaxTokens: 16384,
      supportsVision: true,
      // gpt-5 is a Responses-API family: /v1/chat/completions rejects tools
      // with any reasoning_effort other than "none", while /v1/responses
      // supports tools + effort together. Route it there on the openai
      // backend; on chat completions the request builder clamps the effort.
      apiProtocol: 'responses',
    },
  },
  {
    pattern: 'gemma-4',
    profile: {
      name: 'Gemma 4',
      temperature: 0.7,
      topP: 0.9,
      defaultMaxTokens: 16384,
      supportsVision: true,
    },
  },
]

/**
 * Get the profile for a model by name.
 * Matches patterns in order, returns first match or default.
 */
export function getModelProfile(modelName: string): ModelProfile {
  const lowerName = modelName.toLowerCase()

  // Mock model
  if (lowerName.includes('mock')) {
    return MOCK_PROFILE
  }

  for (const { pattern, profile } of MODEL_PROFILES) {
    if (lowerName.includes(pattern.toLowerCase())) {
      return profile
    }
  }

  return DEFAULT_PROFILE
}

/**
 * Check if a model supports vision/images.
 */
export function modelSupportsVision(modelName: string): boolean {
  return getModelProfile(modelName).supportsVision
}
