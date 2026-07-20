import { randomUUID } from 'node:crypto'
import { resolve, isAbsolute } from 'node:path'
import type { ToolResult } from '../../shared/types.js'
import type { Tool, ToolContext } from './types.js'
import type { LLMToolDefinition } from '../llm/types.js'
import type { SessionManager } from '../session/manager.js'
import { requestPathAccess, PathAccessDeniedError, registerPathConfirmation } from './path-security.js'
import { AskUserInterrupt } from './ask.js'
import { createChatPathConfirmationMessage } from '../ws/protocol.js'
import { getEventStore } from '../events/index.js'

/**
 * Helper utilities provided to tool handlers by createTool.
 * These encapsulate common patterns like path resolution and result formatting.
 */
export interface ToolHelpers {
  /** Resolve a path relative to workdir (or return as-is if absolute) */
  resolvePath: (path: string) => string

  /** Check path access and request user confirmation if needed. Throws PathAccessDeniedError if denied. */
  checkPathAccess: (paths: string[], command?: string) => Promise<void>

  /** Create an error result with timing */
  error: (message: string, truncated?: boolean) => ToolResult

  /** Create a success result with timing */
  success: (output: string, truncated?: boolean, extra?: Partial<ToolResult>) => ToolResult
}

/**
 * Handler function type for tools created with createTool.
 * Receives typed args, context, and helper utilities.
 */
export type ToolHandler<TArgs> = (args: TArgs, context: ToolContext, helpers: ToolHelpers) => Promise<ToolResult>

/**
 * Create a tool with common boilerplate handled automatically:
 * - Timing (durationMs)
 * - Error handling with PathAccessDeniedError re-throw
 * - Path resolution helper
 * - Success/error result helpers
 *
 * @param name - Tool name
 * @param definition - LLM tool definition
 * @param handler - Tool implementation receiving typed args and helpers
 * @returns Tool object ready for registration
 *
 * @example
 * ```ts
 * interface ReadFileArgs { path: string; offset?: number }
 *
 * export const readFileTool = createTool<ReadFileArgs>(
 *   'read_file',
 *   definition,
 *   async (args, context, helpers) => {
 *     const fullPath = helpers.resolvePath(args.path)
 *     await helpers.checkPathAccess([fullPath])
 *     const content = await readFile(fullPath, 'utf-8')
 *     return helpers.success(content)
 *   }
 * )
 * ```
 */
/**
 * Compose a timeout signal with an optional context cancellation signal.
 * If context provides a signal (e.g. user cancel), the returned signal
 * triggers on whichever fires first.
 */
export function requestUserConfirmation(context: ToolContext, toolLabel: string, desc: string): Promise<boolean> {
  // In dangerous mode, auto-approve all shell guard confirmations
  if (context.dangerLevel === 'dangerous') return Promise.resolve(true)
  // Sub-agent shortcut: skip confirmation dialogs since they don't render in the sub-agent bubble.
  // Already handled by dangerous check above; in normal mode, deny (fail closed).
  if (context.isSubAgent) return Promise.resolve(false)
  if (typeof context.onEvent !== 'function') return Promise.resolve(false)
  // Use the tool call ID so the frontend can match this confirmation to the tool call UI.
  // Fall back to a fresh UUID if no toolCallId is available.
  const callId = context.toolCallId ?? randomUUID()
  // Persist to EventStore so the confirmation survives navigation/reload
  try {
    const eventStore = getEventStore()
    eventStore.append(context.sessionId, {
      type: 'path.confirmation_pending',
      data: { callId, tool: toolLabel, paths: [desc], workdir: context.workdir, reason: 'dangerous_command' },
    })
  } catch {
    // Event store not available (tests, early init)
  }
  // Register the resolver BEFORE emitting to client (prevent race)
  const promise = registerPathConfirmation(
    callId,
    [desc],
    context.sessionId,
    toolLabel,
    context.workdir,
    'dangerous_command',
  )
  ;(context.onEvent as (msg: unknown) => void)(
    createChatPathConfirmationMessage(callId, toolLabel, [desc], context.workdir, 'dangerous_command'),
  )
  return promise
}

export function buildSignal(timeoutMs: number, contextSignal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  if (contextSignal) {
    return AbortSignal.any([timeoutSignal, contextSignal])
  }
  return timeoutSignal
}

export function validateAction(
  action: string | undefined,
  allowed: string[],
  startTime: number,
): ToolResult | undefined {
  if (!action || !allowed.includes(action)) {
    return {
      success: false,
      error: `Invalid action: ${action}. Must be one of: ${allowed.join(', ')}`,
      durationMs: Date.now() - startTime,
      truncated: false,
    }
  }
  return undefined
}

export function checkActionPermission(
  action: string | undefined,
  permittedActions: string[] | undefined,
  startTime: number,
): ToolResult | undefined {
  if (action && permittedActions && permittedActions.length > 0 && !permittedActions.includes(action)) {
    return {
      success: false,
      error: `Action '${action}' not allowed. Available: ${permittedActions.join(', ')}`,
      durationMs: Date.now() - startTime,
      truncated: false,
    }
  }
  return undefined
}

export function requireSession(
  sessionManager: SessionManager,
  sessionId: string,
): ReturnType<SessionManager['requireSession']> {
  return sessionManager.requireSession(sessionId)
}

export function unexpectedError(startTime: number): ToolResult {
  return {
    success: false,
    error: 'Unexpected error',
    durationMs: Date.now() - startTime,
    truncated: false,
  }
}

export function catchError(error: unknown, startTime: number): ToolResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
    durationMs: Date.now() - startTime,
    truncated: false,
  }
}

export function validateActionWithPermission(
  action: string | undefined,
  allowedActions: string[],
  toolName: string,
  permittedActions: Record<string, string[]> | undefined,
  startTime?: number,
): ToolResult | undefined {
  const actionError = validateAction(action, allowedActions, startTime ?? Date.now())
  if (actionError) return actionError

  const permittedToolActions = permittedActions?.[toolName]
  const permissionError = checkActionPermission(action, permittedToolActions, startTime ?? Date.now())
  if (permissionError) return permissionError

  return undefined
}

export function createTool<TArgs>(name: string, definition: LLMToolDefinition, handler: ToolHandler<TArgs>): Tool {
  return {
    name,
    definition,
    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const startTime = Date.now()

      // Create helpers with timing closure
      const helpers: ToolHelpers = {
        resolvePath: (path: string) => (isAbsolute(path) ? path : resolve(context.workdir, path)),

        checkPathAccess: async (paths: string[], command?: string) => {
          if (context.onEvent) {
            await requestPathAccess(
              paths,
              context.workdir,
              context.sessionId,
              context.toolCallId ?? crypto.randomUUID(),
              name,
              context.onEvent,
              context.dangerLevel,
              command,
              context.isSubAgent,
            )
          }
        },

        error: (message: string, truncated = false) => ({
          success: false,
          error: message,
          durationMs: Date.now() - startTime,
          truncated,
        }),

        success: (output: string, truncated = false, extra?: Partial<ToolResult>) => ({
          success: true,
          output,
          durationMs: Date.now() - startTime,
          truncated,
          ...extra,
        }),
      }

      try {
        return await handler(args as TArgs, context, helpers)
      } catch (error) {
        // Re-throw path access and ask-user errors for orchestrator to handle
        if (error instanceof PathAccessDeniedError || error instanceof AskUserInterrupt) {
          throw error
        }

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error in tool execution',
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
    },
  }
}
