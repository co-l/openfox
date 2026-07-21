import { z } from 'zod'
import type { Config, LlmBackend } from '../shared/types.js'

const backendSchema = z.enum(['vllm', 'sglang', 'ollama', 'llamacpp', 'unknown']).default('unknown')

const envSchema = z.object({
  // New env var name, with fallback to old name for backward compatibility
  OPENFOX_LLM_URL: z.string().url().optional(),
  OPENFOX_VLLM_URL: z.string().url().optional(),
  OPENFOX_BACKEND: backendSchema,
  OPENFOX_MODEL_NAME: z.string().default(''),
  OPENFOX_MAX_CONTEXT: z.coerce.number().default(200000),
  OPENFOX_COMPACTION_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  OPENFOX_PORT: z.coerce.number().default(10369),
  OPENFOX_HOST: z.string().optional(),
  OPENFOX_WORKDIR: z.string().optional(),
  OPENFOX_DB_PATH: z.string().default('./openfox.db'),
  OPENFOX_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  OPENFOX_REASONING_EFFORT: z.string().optional(),
  // Deprecated: use OPENFOX_REASONING_EFFORT=none instead
  OPENFOX_DISABLE_THINKING: z.coerce.boolean().default(false),
  OPENFOX_LLM_TIMEOUT: z.coerce.number().default(300_000),
  OPENFOX_LLM_IDLE_TIMEOUT: z.coerce.number().default(300_000),
  OPENFOX_DEV: z.coerce.boolean().default(false),
  OPENFOX_DISABLE_AUTO_SESSION_TITLE: z.coerce.boolean().optional(),
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
      timeout: env.OPENFOX_LLM_TIMEOUT,
      idleTimeout: env.OPENFOX_LLM_IDLE_TIMEOUT,
      backend: env.OPENFOX_BACKEND as LlmBackend,
      ...(env.OPENFOX_REASONING_EFFORT
        ? { reasoningEffort: env.OPENFOX_REASONING_EFFORT }
        : env.OPENFOX_DISABLE_THINKING
          ? { reasoningEffort: 'none' }
          : {}),
    },
    context: {
      maxTokens: env.OPENFOX_MAX_CONTEXT,
      compactionThreshold: env.OPENFOX_COMPACTION_THRESHOLD,
    },
    agent: {
      maxIterations: 10,
      maxConsecutiveFailures: 3,
      toolTimeout: 300_000,
    },
    server: {
      port: env.OPENFOX_PORT,
      ...(env.OPENFOX_HOST !== undefined ? { host: env.OPENFOX_HOST } : {}),
    },
    database: {
      path: env.OPENFOX_DB_PATH,
    },
    mode: env.OPENFOX_DEV ? 'development' : 'production',
    workdir,
    ...(env.OPENFOX_DISABLE_AUTO_SESSION_TITLE !== undefined
      ? { disableAutoSessionTitle: env.OPENFOX_DISABLE_AUTO_SESSION_TITLE }
      : {}),
  }
}

export type { Config }
