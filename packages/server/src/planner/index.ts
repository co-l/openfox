import type { Criterion, ToolCall } from '@openfox/shared'
import type { LLMClient, LLMMessage } from '../llm/types.js'
import type { ToolRegistry } from '../tools/index.js'
import { sessionManager } from '../session/index.js'
import { buildPlanningMessages, PLANNING_TOOLS } from './prompts.js'
import { streamWithSegments } from '../llm/streaming.js'
import { logger } from '../utils/logger.js'
import { estimateTokens } from '../context/tokenizer.js'

export type PlannerEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'thinking_delta'; content: string }
  | { type: 'tool_call'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; result: string }
  | { type: 'criteria_set'; criteria: Criterion[] }
  | { type: 'done' }
  | { type: 'error'; error: string }

export async function* plannerChat(
  sessionId: string,
  userMessage: string,
  llmClient: LLMClient,
  toolRegistry: ToolRegistry
): AsyncGenerator<PlannerEvent> {
  const session = sessionManager.requireSession(sessionId)
  
  // Add user message to session
  sessionManager.addMessage(sessionId, {
    role: 'user',
    content: userMessage,
    tokenCount: estimateTokens(userMessage),
  })
  
  // Planning tools (read-only)
  const planningTools = PLANNING_TOOLS
  
  // Build initial messages with dynamic system prompt
  let messages = buildPlanningMessages(
    planningTools,
    session.messages
      .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
      .map(m => ({ 
        role: m.role, 
        content: m.content,
        toolCalls: m.toolCalls,
        toolCallId: m.toolCallId,
      }))
      .concat([{ role: 'user', content: userMessage }])
  )
  
  // Loop to handle tool calls
  let iteration = 0
  const maxIterations = 10
  
  // Only these tools are allowed in planning mode
  const allowedPlanningTools = [
    'read_file', 'glob', 'grep',
    'get_criteria', 'add_criterion', 'update_criterion', 'remove_criterion'
  ]
  
  while (iteration < maxIterations) {
    iteration++
    
    // Stream LLM response with segment tracking
    const stream = streamWithSegments(llmClient, {
      messages,
      tools: planningTools,
      toolChoice: 'auto',
    })
    
    let streamResult: Awaited<ReturnType<typeof stream.next>>['value'] = null
    
    // Forward streaming events and get final result
    while (true) {
      const { value, done } = await stream.next()
      
      if (done) {
        streamResult = value
        break
      }
      
      // Forward event to caller
      switch (value.type) {
        case 'text_delta':
          yield { type: 'text_delta', content: value.content }
          break
        case 'thinking_delta':
          yield { type: 'thinking_delta', content: value.content }
          break
        case 'error':
          yield { type: 'error', error: value.error }
          return
      }
    }
    
    // Check if streaming failed
    if (!streamResult) {
      yield { type: 'error', error: 'Stream ended without result' }
      return
    }
    
    const { content, thinkingContent, toolCalls, response, segments } = streamResult
    
    // Save assistant message with segments for proper ordering on reload
    sessionManager.addMessage(sessionId, {
      role: 'assistant',
      content,
      thinkingContent: thinkingContent || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      tokenCount: response.usage.completionTokens,
      segments,
    })
    
    // Update context size (for compaction decisions) and cumulative usage (for metrics)
    sessionManager.setCurrentContextSize(sessionId, response.usage.promptTokens)
    sessionManager.addTokensUsed(sessionId, response.usage.promptTokens + response.usage.completionTokens)
    
    // If no tool calls, we're done
    if (toolCalls.length === 0) {
      yield { type: 'done' }
      return
    }
    
    // Execute tool calls
    const toolMessages: LLMMessage[] = []
    
    for (const toolCall of toolCalls) {
      yield { type: 'tool_call', tool: toolCall.name, args: toolCall.arguments }
      
      let resultContent: string
      let updatedCriteria: Criterion[] | null = null
      
      // Guard: reject tools not in the allowed list
      if (!allowedPlanningTools.includes(toolCall.name)) {
        resultContent = `Error: Tool "${toolCall.name}" is not available in planning mode. Only exploration tools (read_file, glob, grep) and criteria tools (get_criteria, add_criterion, update_criterion, remove_criterion) are allowed. Do NOT attempt to edit files during planning.`
        logger.warn('Planner attempted forbidden tool', { tool: toolCall.name, sessionId })
      } else {
        // Handle criteria tools
        const criteriaResult = handleCriteriaTool(sessionId, toolCall.name, toolCall.arguments)
        
        if (criteriaResult !== null) {
          resultContent = criteriaResult.message
          updatedCriteria = criteriaResult.criteria
        } else {
          // Regular tool execution via registry (read_file, glob, grep)
          const result = await toolRegistry.execute(
            toolCall.name,
            toolCall.arguments,
            { workdir: session.workdir, sessionId }
          )
          
          resultContent = result.success 
            ? (result.output ?? 'Success')
            : `Error: ${result.error}`
        }
      }
      
      // Emit criteria update if changed
      if (updatedCriteria !== null) {
        yield { type: 'criteria_set', criteria: updatedCriteria }
      }
      
      yield { type: 'tool_result', tool: toolCall.name, result: resultContent.slice(0, 500) }
      
      // Save tool result message
      sessionManager.addMessage(sessionId, {
        role: 'tool',
        content: resultContent,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        toolResult: { success: true, output: resultContent, durationMs: 0, truncated: false },
        tokenCount: estimateTokens(resultContent),
      })
      
      toolMessages.push({
        role: 'tool',
        content: resultContent,
        toolCallId: toolCall.id,
      })
    }
    
    // Add assistant message with tool calls and tool results to messages
    messages = [
      ...messages,
      {
        role: 'assistant' as const,
        content,
        toolCalls,
      },
      ...toolMessages,
    ]
  }
  
  yield { type: 'done' }
}

// ============================================================================
// Criteria Tool Handlers
// ============================================================================

interface CriteriaToolResult {
  message: string
  criteria: Criterion[] | null
}

/**
 * Handle criteria CRUD tools. Returns null if not a criteria tool.
 */
function handleCriteriaTool(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>
): CriteriaToolResult | null {
  const session = sessionManager.requireSession(sessionId)
  
  switch (toolName) {
    case 'get_criteria': {
      const criteria = session.criteria
      return {
        message: criteria.length === 0
          ? 'No criteria defined yet.'
          : JSON.stringify(criteria.map(c => ({
              id: c.id,
              description: c.description,
            })), null, 2),
        criteria: null, // No change, don't emit event
      }
    }
    
    case 'add_criterion': {
      const { id, description } = args as { id: string; description: string }
      
      // Validate required fields
      if (!id || typeof id !== 'string') {
        return { message: 'Error: id is required', criteria: null }
      }
      if (!description || typeof description !== 'string') {
        return { message: 'Error: description is required', criteria: null }
      }
      
      // Check for duplicate ID
      if (session.criteria.find(c => c.id === id)) {
        return { message: `Error: criterion with id "${id}" already exists`, criteria: null }
      }
      
      const criterion: Criterion = {
        id,
        description,
        status: { type: 'pending' },
        attempts: [],
      }
      
      const criteria = sessionManager.addCriterion(sessionId, criterion)
      return {
        message: `Added criterion "${id}". Current criteria:\n${formatCriteriaList(criteria)}`,
        criteria,
      }
    }
    
    case 'update_criterion': {
      const { id, description } = args as { id: string; description?: string }
      
      if (!id) {
        return { message: 'Error: id is required', criteria: null }
      }
      
      if (!session.criteria.find(c => c.id === id)) {
        return { message: `Error: criterion "${id}" not found`, criteria: null }
      }
      
      if (!description) {
        return { message: 'Error: description is required for update', criteria: null }
      }
      
      const criteria = sessionManager.updateCriterionFull(sessionId, id, { description })
      return {
        message: `Updated criterion "${id}". Current criteria:\n${formatCriteriaList(criteria)}`,
        criteria,
      }
    }
    
    case 'remove_criterion': {
      const { id } = args as { id: string }
      
      if (!id) {
        return { message: 'Error: id is required', criteria: null }
      }
      
      if (!session.criteria.find(c => c.id === id)) {
        return { message: `Error: criterion "${id}" not found`, criteria: null }
      }
      
      const criteria = sessionManager.removeCriterion(sessionId, id)
      return {
        message: criteria.length === 0
          ? `Removed criterion "${id}". No criteria remaining.`
          : `Removed criterion "${id}". Current criteria:\n${formatCriteriaList(criteria)}`,
        criteria,
      }
    }
    
    default:
      return null
  }
}

function formatCriteriaList(criteria: Criterion[]): string {
  return criteria.map(c => `- ${c.id}: ${c.description}`).join('\n')
}

export async function acceptCriteria(sessionId: string): Promise<void> {
  const session = sessionManager.requireSession(sessionId)
  
  if (session.criteria.length === 0) {
    throw new Error('Cannot accept: no criteria defined')
  }
  
  // Transition to executing phase
  sessionManager.transition(sessionId, 'executing')
}
