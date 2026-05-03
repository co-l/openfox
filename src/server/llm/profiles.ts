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

  /** Whether the model outputs reasoning/thinking content */
  supportsReasoning: boolean

  /** Whether reasoning should be treated as regular content (for broken configs) */
  reasoningAsContent: boolean

  /** Max tokens to generate if not specified */
  defaultMaxTokens: number

  /** Whether the model supports vision/images */
  supportsVision: boolean
}

/** Default profile for unknown models */
const DEFAULT_PROFILE: ModelProfile = {
  name: 'default',
  temperature: 0.7,
  topP: 0.9,
  supportsReasoning: false,
  reasoningAsContent: false,
  defaultMaxTokens: 4096,
  supportsVision: true,
}

/** Profile for mock LLM testing */
const MOCK_PROFILE: ModelProfile = {
  name: 'mock',
  temperature: 0.7,
  topP: 0.9,
  supportsReasoning: false,
  reasoningAsContent: false,
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
      supportsReasoning: false,
      reasoningAsContent: false,
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
      supportsReasoning: false,
      reasoningAsContent: false,
      defaultMaxTokens: 16384,
      supportsVision: false,
    },
  },
  {
    pattern: 'qwen3',
    profile: {
      name: 'Qwen3',
      temperature: 0.7,
      topP: 0.9,
      supportsReasoning: true,
      reasoningAsContent: false,
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
      supportsReasoning: true,
      reasoningAsContent: false,
      defaultMaxTokens: 16384,
      supportsVision: true,
    },
  },
  {
    pattern: 'deepseek',
    profile: {
      name: 'DeepSeek',
      temperature: 0.6,
      topP: 0.95,
      supportsReasoning: true,
      reasoningAsContent: false,
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
      supportsReasoning: true,
      reasoningAsContent: false,
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
      supportsReasoning: true,
      reasoningAsContent: false,
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
      supportsReasoning: true,
      reasoningAsContent: false,
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
      supportsReasoning: true,
      reasoningAsContent: false,
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
      supportsReasoning: false,
      reasoningAsContent: false,
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
      supportsReasoning: false,
      reasoningAsContent: false,
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
      supportsReasoning: true,
      reasoningAsContent: false,
      defaultMaxTokens: 16384,
      supportsVision: false,
    },
  },
  {
    pattern: 'gemma-4',
    profile: {
      name: 'Gemma 4',
      temperature: 0.7,
      topP: 0.9,
      supportsReasoning: true,
      reasoningAsContent: false,
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
 * Check if a model supports reasoning/thinking output.
 */
export function modelSupportsReasoning(modelName: string): boolean {
  return getModelProfile(modelName).supportsReasoning
}

/**
 * Check if a model supports vision/images.
 */
export function modelSupportsVision(modelName: string): boolean {
  return getModelProfile(modelName).supportsVision
}
