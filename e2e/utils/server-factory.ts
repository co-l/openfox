/**
 * In-process server factory for E2E tests.
 *
 * Creates isolated server instances that can run in parallel.
 * Each test file gets its own server on a dynamic port with its own config file.
 */

import type { ServerHandle } from '../../src/server/context.js'
import type { Config } from '../../src/shared/types.js'
import { loadConfig } from '../../src/server/config.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

// Create test config by modifying env vars before calling loadConfig
function createTestConfig(options: { maxContext?: number } = {}): Config {
  // Set test-specific env vars (loadConfig reads from process.env)
  process.env['OPENFOX_DB_PATH'] = ':memory:'
  process.env['OPENFOX_LOG_LEVEL'] = 'error'
  process.env['OPENFOX_HOST'] = '127.0.0.1'
  process.env['OPENFOX_PORT'] = '0' // Will be overridden by start(0) anyway
  if (options.maxContext !== undefined) {
    process.env['OPENFOX_MAX_CONTEXT'] = String(options.maxContext)
  }

  const config = loadConfig()

  if (options.maxContext !== undefined) {
    config.context.maxTokens = options.maxContext
  }

  // Use test mode to isolate config from production
  config.mode = 'test'

  // Give this server its own isolated config file so parallel tests don't clash
  config.globalConfigPath = join(tmpdir(), `openfox-e2e-config-${randomUUID()}.json`)

  return config
}

export interface TestServerHandle extends ServerHandle {
  /** Base URL for HTTP requests (e.g., http://127.0.0.1:3456) */
  url: string
  /** WebSocket URL (e.g., ws://127.0.0.1:3456/ws) */
  wsUrl: string
  /** The dynamically assigned port */
  port: number
  /** Path to the isolated global config file for this server */
  globalConfigPath: string
}

/**
 * Create and start an isolated test server.
 *
 * Usage:
 * ```ts
 * let server: TestServerHandle
 *
 * beforeAll(async () => {
 *   server = await createTestServer()
 * })
 *
 * afterAll(async () => {
 *   await server.close()
 * })
 * ```
 */
export async function createTestServer(options: { maxContext?: number } = {}): Promise<TestServerHandle> {
  // Set mock LLM env before importing server (it reads env at module load time)
  process.env['OPENFOX_MOCK_LLM'] = 'true'

  // Dynamic import to ensure fresh module state and env vars are applied
  // Use src/ - tsx loader in vitest config will resolve TypeScript files
  const { createServerHandle } = await import('../../src/server/index.js')

  const config = createTestConfig(options)
  const handle = await createServerHandle(config)
  const { port } = await handle.start(0) // Dynamic port

  const url = `http://127.0.0.1:${port}`
  const wsUrl = `ws://127.0.0.1:${port}/ws`

  return {
    ...handle,
    url,
    wsUrl,
    port,
    globalConfigPath: config.globalConfigPath!,
  }
}
