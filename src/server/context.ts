/**
 * Server Context
 * 
 * Holds all server dependencies in a single object that can be passed through
 * the application. This replaces singleton imports and enables:
 * - Easy testing with isolated instances
 * - Parallel test execution
 * - Clear dependency flow
 */

import type { Server } from 'node:http'
import type { Config } from './config.js'
import type { LLMClientWithModel } from './llm/client.js'
import type { ToolRegistry } from './tools/types.js'
import { SessionManager } from './session/manager.js'

// ============================================================================
// Types
// ============================================================================

export interface ServerContext {
  config: Config
  sessionManager: SessionManager
  llmClient: LLMClientWithModel
  toolRegistry: ToolRegistry
}

export interface ServerHandle {
  httpServer: Server
  ctx: ServerContext
  /** Start listening on the given port (0 for dynamic) */
  start: (port?: number) => Promise<{ port: number }>
  /** Gracefully close the server */
  close: () => Promise<void>
}
