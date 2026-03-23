/**
 * Sub-Agent Manager
 * 
 * Executes sub-agents with isolated context and restricted tool sets.
 */

import type { SessionManager } from '../session/index.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { SubAgentType } from './types.js'
import { createSubAgentRegistry } from './registry.js'
import { streamLLMResponse } from '../chat/stream.js'
import { logger } from '../utils/logger.js'
import type { ToolRegistry } from '../tools/types.js'
import type { ServerMessage } from '../../shared/protocol.js'
import { createToolProgressHandler } from '../chat/tool-streaming.js'
import { createChatToolCallMessage, createChatToolResultMessage } from '../ws/protocol.js'
import { PathAccessDeniedError } from '../tools/path-security.js'

export interface SubAgentManager {
  /**
   * Execute a sub-agent with isolated context
   */
  executeSubAgent(
    subAgentType: SubAgentType,
    prompt: string,
    sessionManager: SessionManager,
    sessionId: string,
    llmClient: LLMClientWithModel,
    toolRegistry: ToolRegistry,  // Pass tool registry as parameter to avoid circular dependency
    onMessage?: (msg: ServerMessage) => void  // Optional callback to stream events to UI
  ): Promise<string>
}

export function createSubAgentManager(): SubAgentManager {
  const registry = createSubAgentRegistry()

  return {
    async executeSubAgent(
      subAgentType: SubAgentType,
      prompt: string,
      sessionManager: SessionManager,
      sessionId: string,
      llmClient: LLMClientWithModel,
      toolRegistry: ToolRegistry,
      onMessage?: (msg: ServerMessage) => void
    ): Promise<string> {
      // 1. Get sub-agent definition from registry
      const definition = registry.getSubAgent(subAgentType)
      if (!definition) {
        throw new Error(`Unknown sub-agent type: ${subAgentType}`)
      }

      // 2. Get current session
      const session = sessionManager.requireSession(sessionId)

      // 3. Build fresh context using definition's createContext function
      const subAgentId = crypto.randomUUID()
      let contextContent = definition.createContext(session, { prompt })
      // Track the base message indices (context + prompt) so we can refresh them
      const baseMessageCount = contextContent.messages.length

      // 4. Add context reset marker to main session (visible in UI)
      sessionManager.addMessage(sessionId, {
        role: 'user',
        content: `Fresh Context - ${definition.name} Sub-Agent`,
        isSystemGenerated: true,
        messageKind: 'context-reset',
        subAgentId,
        subAgentType,
      })

      // 5. Add prompt message
      sessionManager.addMessage(sessionId, {
        role: 'user',
        content: prompt,
        isSystemGenerated: true,
        messageKind: 'auto-prompt',
        subAgentId,
        subAgentType,
      })

      // 6. Use the passed tool registry (avoiding circular dependency)
      const tools = toolRegistry.definitions

      // Create ONE assistant message at the start and reuse it throughout
      const assistantMsg = sessionManager.addAssistantMessage(sessionId, {
        content: '',
        isStreaming: true,
        subAgentId,
        subAgentType,
      })
      const assistantMsgId = assistantMsg.id

      // 7. Run LLM turn with isolated context, executing tool calls
      const maxIterations = 20
      let iteration = 0
      let finalContent = ''

      while (iteration < maxIterations) {
        iteration++

        // Refresh the base context (first N messages) from session to get updated criterion statuses
        // Keep tool results (messages after the base)
        const currentSession = sessionManager.requireSession(sessionId)
        const freshContext = definition.createContext(currentSession, { prompt })
        // Keep only tool result messages (after the base messages)
        const toolResultMessages = contextContent.messages.slice(baseMessageCount)
        // Replace base messages with fresh ones, keep tool results
        contextContent.messages = [...freshContext.messages, ...toolResultMessages]

        // Stream LLM response, reusing the same assistant message ID
        const result = await streamLLMResponse({
          sessionManager,
          sessionId,
          systemPrompt: definition.systemPrompt,
          llmClient,
          tools,
          toolChoice: 'auto',
          customMessages: contextContent.messages,
          subAgentId,
          subAgentType,
          disableThinking: contextContent.requestOptions.disableThinking,
          onEvent: onMessage ?? (() => {}),
          existingMessageId: assistantMsgId,
        })

        finalContent = result.content

        // Execute tool calls if any
        if (result.toolCalls.length > 0) {
          for (const toolCall of result.toolCalls) {
            // Emit tool call event
            if (onMessage) {
              onMessage(createChatToolCallMessage(assistantMsgId, toolCall.id, toolCall.name, toolCall.arguments))
            }

            // Create progress handler for streaming output (run_command only)
            const onProgress = onMessage ? createToolProgressHandler(assistantMsgId, toolCall.id, onMessage) : undefined

            // Execute the tool
            let toolResult
            try {
              toolResult = await toolRegistry.execute(
                toolCall.name,
                toolCall.arguments,
                {
                  sessionManager,
                  workdir: session.workdir,
                  sessionId,
                  signal: undefined, // No signal for sub-agent execution
                  lspManager: sessionManager.getLspManager(sessionId),
                  onEvent: onMessage ?? (() => {}),
                  onProgress,
                }
              )
            } catch (error: unknown) {
              if (error instanceof PathAccessDeniedError) {
                toolResult = {
                  success: false,
                  error: `User denied access to ${error.paths.join(', ')}.`,
                  durationMs: 0,
                  truncated: false,
                }
              } else {
                throw error
              }
            }

            // Emit tool result event
            if (onMessage) {
              onMessage(createChatToolResultMessage(assistantMsgId, toolCall.id, toolCall.name, toolResult))
            }

            // Add tool result to custom context for next iteration
            contextContent.messages.push({
              role: 'tool',
              content: toolResult.success ? (toolResult.output ?? 'Success') : `Error: ${toolResult.error}`,
              toolCallId: toolCall.id,
              source: 'runtime' as const,
            })
          }

          // Continue to next iteration to process tool results
          continue
        }

        // No tool calls - sub-agent is done
        break
      }

      // 8. Return free-form text result
      logger.debug('Sub-agent execution complete', {
        subAgentType,
        subAgentId,
        resultLength: finalContent.length,
      })

      return finalContent
    },
  }
}
