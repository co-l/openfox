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
}

/** Default profile for unknown models */
const DEFAULT_PROFILE: ModelProfile = {
  name: 'default',
  temperature: 0.7,
  topP: 0.9,
  supportsReasoning: true,
  reasoningAsContent: false,
  defaultMaxTokens: 4096,
}

/** 
 * Model profiles indexed by model name patterns.
 * Patterns are matched against the model name (case-insensitive, partial match).
 */
const MODEL_PROFILES: Array<{ pattern: string; profile: ModelProfile }> = [
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
      defaultMaxTokens: 8192,
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
      defaultMaxTokens: 4096,
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
      defaultMaxTokens: 4096,
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
      defaultMaxTokens: 4096,
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
      defaultMaxTokens: 4096,
    },
  },
]

/**
 * Get the profile for a model by name.
 * Matches patterns in order, returns first match or default.
 */
export function getModelProfile(modelName: string): ModelProfile {
  const lowerName = modelName.toLowerCase()
  
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
