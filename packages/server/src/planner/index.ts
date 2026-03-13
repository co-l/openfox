import type { Criterion, CriterionVerification, ToolCall } from '@openfox/shared'
import type { LLMClient, LLMMessage } from '../llm/types.js'
import type { ToolRegistry } from '../tools/index.js'
import { sessionManager } from '../session/index.js'
import { buildPlanningMessages, PLANNING_TOOLS } from './prompts.js'
import { logger } from '../utils/logger.js'
import { estimateTokens } from '../context/tokenizer.js'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

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
  
  // Build initial messages
  let messages = buildPlanningMessages(
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
  
  // Planning tools (read-only)
  const planningTools = PLANNING_TOOLS
  
  // Loop to handle tool calls
  let iteration = 0
  const maxIterations = 10
  
  while (iteration < maxIterations) {
    iteration++
    
    let fullContent = ''
    let thinkingContent = ''
    let toolCalls: ToolCall[] = []
    
    try {
      for await (const event of llmClient.stream({ 
        messages,
        tools: planningTools,
        toolChoice: 'auto',
      })) {
        switch (event.type) {
          case 'text_delta':
            fullContent += event.content
            yield { type: 'text_delta', content: event.content }
            break
          
          case 'thinking_delta':
            thinkingContent += event.content
            yield { type: 'thinking_delta', content: event.content }
            break
          
          case 'done':
            toolCalls = event.response.toolCalls ?? []
            
            // Save assistant message
            sessionManager.addMessage(sessionId, {
              role: 'assistant',
              content: fullContent,
              thinkingContent: thinkingContent || undefined,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
              tokenCount: event.response.usage.completionTokens,
            })
            
            // Update token count
            sessionManager.incrementTokenCount(
              sessionId,
              event.response.usage.promptTokens + event.response.usage.completionTokens
            )
            break
          
          case 'error':
            yield { type: 'error', error: event.error }
            return
        }
      }
    } catch (error) {
      logger.error('Planner chat error', { error })
      yield { type: 'error', error: error instanceof Error ? error.message : 'Unknown error' }
      return
    }
    
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
      
      // Handle set_acceptance_criteria specially
      if (toolCall.name === 'set_acceptance_criteria') {
        const criteriaResult = await handleSetCriteria(
          sessionId,
          toolCall.arguments as { criteria: CriteriaInput[] },
          session.workdir
        )
        resultContent = criteriaResult.message
        
        if (criteriaResult.success && criteriaResult.criteria) {
          yield { type: 'criteria_set', criteria: criteriaResult.criteria }
        }
      } else {
        // Regular tool execution via registry
        const result = await toolRegistry.execute(
          toolCall.name,
          toolCall.arguments,
          { workdir: session.workdir, sessionId }
        )
        
        resultContent = result.success 
          ? (result.output ?? 'Success')
          : `Error: ${result.error}`
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
        content: fullContent,
        toolCalls,
      },
      ...toolMessages,
    ]
  }
  
  yield { type: 'done' }
}

// Types for criteria input from tool call
interface CriteriaInput {
  id: string
  description: string
  verification: {
    type: 'auto' | 'model' | 'human'
    command?: string
  }
}

interface SetCriteriaResult {
  success: boolean
  message: string
  criteria?: Criterion[]
}

/**
 * Handle the set_acceptance_criteria tool call.
 * Validates criteria and optionally checks that auto-verification commands exist.
 */
async function handleSetCriteria(
  sessionId: string,
  args: { criteria: CriteriaInput[] },
  workdir: string
): Promise<SetCriteriaResult> {
  const { criteria: inputCriteria } = args
  
  if (!Array.isArray(inputCriteria) || inputCriteria.length === 0) {
    return {
      success: false,
      message: 'Error: criteria must be a non-empty array',
    }
  }
  
  const errors: string[] = []
  const warnings: string[] = []
  
  // Validate each criterion
  for (const c of inputCriteria) {
    if (!c.id || typeof c.id !== 'string') {
      errors.push(`Criterion missing valid id`)
    }
    if (!c.description || typeof c.description !== 'string') {
      errors.push(`Criterion ${c.id}: missing description`)
    }
    if (!c.verification || !['auto', 'model', 'human'].includes(c.verification.type)) {
      errors.push(`Criterion ${c.id}: verification.type must be 'auto', 'model', or 'human'`)
    }
    if (c.verification?.type === 'auto' && !c.verification.command) {
      errors.push(`Criterion ${c.id}: auto verification requires a command`)
    }
  }
  
  if (errors.length > 0) {
    return {
      success: false,
      message: `Validation errors:\n${errors.join('\n')}`,
    }
  }
  
  // For auto criteria, check if the command looks valid
  for (const c of inputCriteria) {
    if (c.verification.type === 'auto' && c.verification.command) {
      const validation = await validateCommand(c.verification.command, workdir)
      if (!validation.valid) {
        warnings.push(`Criterion ${c.id}: ${validation.warning}`)
      }
    }
  }
  
  // Build criteria objects
  const criteria: Criterion[] = inputCriteria.map((c, i) => ({
    id: c.id || `criterion-${i + 1}`,
    description: c.description,
    verification: normalizeVerification(c.verification),
    status: { type: 'pending' as const },
    attempts: [],
  }))
  
  // Save to session
  sessionManager.setCriteria(sessionId, criteria)
  
  let message = `Acceptance criteria set (${criteria.length} criteria)`
  if (warnings.length > 0) {
    message += `\n\nWarnings:\n${warnings.join('\n')}`
  }
  message += '\n\nThe user can now review and edit the criteria before accepting.'
  
  return {
    success: true,
    message,
    criteria,
  }
}

/**
 * Validate that an auto-verification command looks reasonable.
 * Checks if npm scripts exist, common commands are available, etc.
 */
async function validateCommand(
  command: string,
  workdir: string
): Promise<{ valid: boolean; warning?: string }> {
  const trimmed = command.trim()
  
  // Check for npm/yarn/pnpm script commands
  const npmScriptMatch = trimmed.match(/^(npm|yarn|pnpm)\s+(run\s+)?(\w+)/)
  if (npmScriptMatch) {
    const scriptName = npmScriptMatch[3]
    try {
      const { stdout } = await execAsync('cat package.json', { cwd: workdir })
      const pkg = JSON.parse(stdout)
      if (!pkg.scripts?.[scriptName]) {
        return {
          valid: false,
          warning: `npm script "${scriptName}" not found in package.json`,
        }
      }
    } catch {
      // package.json doesn't exist or isn't readable
      return {
        valid: false,
        warning: `Could not verify npm script "${scriptName}" - package.json not found`,
      }
    }
  }
  
  // Basic sanity check - command shouldn't be empty or just whitespace
  if (!trimmed) {
    return { valid: false, warning: 'Command is empty' }
  }
  
  return { valid: true }
}

function normalizeVerification(v: { type: string; command?: string }): CriterionVerification {
  switch (v.type) {
    case 'auto':
      return { type: 'auto', command: v.command ?? 'echo "Manual verification needed"' }
    case 'human':
      return { type: 'human' }
    case 'model':
    default:
      return { type: 'model' }
  }
}

export async function acceptCriteria(sessionId: string): Promise<void> {
  const session = sessionManager.requireSession(sessionId)
  
  if (session.criteria.length === 0) {
    throw new Error('Cannot accept: no criteria defined')
  }
  
  // Transition to executing phase
  sessionManager.transition(sessionId, 'executing')
}
