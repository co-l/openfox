import { z } from 'zod'
import type { Config, LlmBackend } from '../shared/types.js'

const backendSchema = z.enum(['auto', 'vllm', 'sglang', 'ollama', 'llamacpp']).default('auto')

const visionFallbackSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().default('http://localhost:11434'),
  model: z.string().default('qwen3-vl:2b'),
})

const envSchema = z.object({
  // New env var name, with fallback to old name for backward compatibility
  OPENFOX_LLM_URL: z.string().url().optional(),
  OPENFOX_VLLM_URL: z.string().url().optional(),
  OPENFOX_BACKEND: backendSchema,
  OPENFOX_MODEL_NAME: z.string().default('qwen3.5-122b-int4-autoround'),
  OPENFOX_MAX_CONTEXT: z.coerce.number().default(200000),
  OPENFOX_PORT: z.coerce.number().default(10369),
  OPENFOX_HOST: z.string().default('0.0.0.0'),
  OPENFOX_WORKDIR: z.string().optional(),
  OPENFOX_DB_PATH: z.string().default('./openfox.db'),
  OPENFOX_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  OPENFOX_DISABLE_THINKING: z.coerce.boolean().default(false),
  OPENFOX_DEV: z.coerce.boolean().default(false),
})

export function loadConfig(): Config {
  const env = envSchema.parse(process.env)
  
  // Use new env var, fall back to old one, then default
  const llmUrl = env.OPENFOX_LLM_URL ?? env.OPENFOX_VLLM_URL ?? 'http://localhost:8000/v1'
  
  // Workdir from env only (serve.ts will merge with global config)
  const workdir = env.OPENFOX_WORKDIR ?? process.cwd()
  
  return {
    llm: {
      baseUrl: llmUrl,
      model: env.OPENFOX_MODEL_NAME,
      timeout: 300_000, // 5 minutes (deprecated, kept for backward compatibility)
      idleTimeout: 300_000, // 5 minutes of inactivity
      backend: env.OPENFOX_BACKEND as LlmBackend | 'auto',
      disableThinking: env.OPENFOX_DISABLE_THINKING,
    },
    context: {
      maxTokens: env.OPENFOX_MAX_CONTEXT,
      compactionThreshold: 0.85,
      compactionTarget: 0.60,
    },
    agent: {
      maxIterations: 10,
      maxConsecutiveFailures: 3,
      toolTimeout: 120_000,
    },
    server: {
      port: env.OPENFOX_PORT,
      host: env.OPENFOX_HOST,
    },
    database: {
      path: env.OPENFOX_DB_PATH,
    },
    mode: env.OPENFOX_DEV ? 'development' : 'production',
    workdir,
  }
}

export type { Config }
