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
    toolRegistry: ToolRegistry  // Pass tool registry as parameter to avoid circular dependency
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
      toolRegistry: ToolRegistry
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
      const contextContent = definition.createContext(session, { prompt })

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
      // For verifier, we use the verifier tool registry
      // For other sub-agents, we'd need to pass the appropriate registry
      const tools = toolRegistry.definitions

      // 7. Run LLM turn with isolated context
      const onEvent = () => {} // No-op for sub-agent execution - do not stream to UI
      const result = await streamLLMResponse({
        sessionManager,
        sessionId,
        systemPrompt: definition.systemPrompt,
        llmClient,
        tools,
        toolChoice: 'auto',
        customMessages: contextContent.messages, // Fresh context, not main conversation
        subAgentId,
        subAgentType,
        disableThinking: subAgentType === 'verifier',
        onEvent,
      })

      // 8. Return free-form text result
      logger.debug('Sub-agent execution complete', {
        subAgentType,
        subAgentId,
        resultLength: result.content.length,
      })

      return result.content
    },
  }
}
