import { z } from 'zod'
import type { Config } from '@openfox/shared'

const envSchema = z.object({
  OPENFOX_VLLM_URL: z.string().url().default('http://localhost:8000/v1'),
  OPENFOX_MODEL_NAME: z.string().default('qwen3.5-122b-int4-autoround'),
  OPENFOX_MAX_CONTEXT: z.coerce.number().default(200000),
  OPENFOX_PORT: z.coerce.number().default(3000),
  OPENFOX_HOST: z.string().default('0.0.0.0'),
  OPENFOX_WORKDIR: z.string().default(process.cwd()),
  OPENFOX_DB_PATH: z.string().default('./openfox.db'),
  OPENFOX_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

export function loadConfig(): Config {
  const env = envSchema.parse(process.env)
  
  return {
    vllm: {
      baseUrl: env.OPENFOX_VLLM_URL,
      model: env.OPENFOX_MODEL_NAME,
      timeout: 300_000, // 5 minutes
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
  }
}

export type { Config }
