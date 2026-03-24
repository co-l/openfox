// Minimal type definitions for testing
// In production, these would come from '../../../src/shared/types.js'
export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  startedAt?: number
  result?: {
    success: boolean
    output?: string
    error?: string
  }
  streamingOutput?: Array<{ stream: 'stdout' | 'stderr'; content: string }>
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  thinkingContent?: string
  createdAt: string
  updatedAt: string
  isStreaming?: boolean
  isCompacted?: boolean
  isSystemGenerated?: boolean
  messageKind?: 'auto-prompt' | 'context-reset'
  toolName?: string
  subAgentId?: string
  subAgentType?: string
  toolCalls?: ToolCall[]
  preparingToolCalls?: Array<{ index: number; name: string }>
  segments?: Array<{ type: 'text' | 'thinking' | 'tool_call'; content?: string; toolCallId?: string }>
  contextWindowId?: string
  attachments?: Array<{ id: string; filename: string; mimeType: string; size: number; data: string }>
  stats?: unknown
  partial?: boolean
}

// Display item: either a single message, a grouped sub-agent run, criteria batch, or a context window divider
export type DisplayItem = 
  | { type: 'message'; message: Message }
  | { type: 'subagent'; subAgentId: string; subAgentType: 'verifier'; messages: Message[] }
  | { type: 'criteria-batch'; toolCalls: ToolCall[] }
  | { type: 'context-divider'; windowSequence: number }

// Check if a message contains only criterion tool calls (no text content)
// Subagent messages are never criteria-only - they stay grouped in their pane
function isCriterionTool(toolName: string): boolean {
  return toolName.startsWith('criteria_')
}

function isCriteriaOnlyMessage(msg: Message): boolean {
  if (msg.role !== 'assistant') return false
  if (msg.subAgentId) return false  // Keep subagent messages together
  if (msg.content?.trim()) return false  // Has text content
  if (msg.thinkingContent?.trim()) return false  // Has thinking content
  if (!msg.toolCalls || msg.toolCalls.length === 0) return false  // No tool calls
  return msg.toolCalls.every((tc: { name: string }) => isCriterionTool(tc.name))
}

/**
 * Group messages into display items, collapsing consecutive sub-agent messages,
 * consecutive criteria-only messages, and inserting context window dividers.
 * 
 * This function preserves object identity for unchanged display items when given
 * a previousItems array, allowing React's memo() to skip unnecessary re-renders.
 */
export function groupMessages(messages: Message[], previousItems: DisplayItem[] = []): DisplayItem[] {
  const items: DisplayItem[] = []
  let currentSubAgentGroup: { subAgentId: string; subAgentType: 'verifier'; messages: Message[] } | null = null
  let criteriaBuffer: ToolCall[] = []
  let lastContextWindowId: string | undefined
  let windowSequence = 1
  
  // Create a map of message IDs to previous display items for identity preservation
  const previousItemsByMessageId = new Map<string, DisplayItem>()
  const previousItemsBySubAgentId = new Map<string, DisplayItem>()
  const previousCriteriaBatches: DisplayItem[] = []
  
  for (const item of previousItems) {
    if (item.type === 'message') {
      previousItemsByMessageId.set(item.message.id, item)
    } else if (item.type === 'subagent') {
      previousItemsBySubAgentId.set(item.subAgentId, item)
    } else if (item.type === 'criteria-batch') {
      previousCriteriaBatches.push(item)
    }
  }
  
  let criteriaBatchIndex = 0
  
  const flushCriteriaBuffer = () => {
    if (criteriaBuffer.length > 0) {
      // Try to reuse a previous criteria-batch if tool calls match
      const previousBatch = previousCriteriaBatches[criteriaBatchIndex]
      const toolCallsMatch = 
        previousBatch &&
        previousBatch.type === 'criteria-batch' &&
        previousBatch.toolCalls.length === criteriaBuffer.length &&
        previousBatch.toolCalls.every((tc, i) => tc.id === criteriaBuffer[i]?.id)
      
      if (toolCallsMatch) {
        items.push(previousBatch)
      } else {
        items.push({ type: 'criteria-batch', toolCalls: [...criteriaBuffer] })
      }
      criteriaBatchIndex++
      criteriaBuffer = []
    }
  }
  
  const flushSubAgentGroup = () => {
    if (!currentSubAgentGroup) return
    
    const group = currentSubAgentGroup
    
    // Try to find a previous sub-agent item with the same ID
    const previousSubAgentItem = previousItemsBySubAgentId.get(group.subAgentId)
    
    // Check if all messages in the group are the same (by ID)
    const messagesMatch = 
      previousSubAgentItem &&
      previousSubAgentItem.type === 'subagent' &&
      previousSubAgentItem.messages.length === group.messages.length &&
      previousSubAgentItem.messages.every((m, i) => m === group.messages[i])
    
    if (messagesMatch) {
      // Reuse the previous item
      items.push(previousSubAgentItem)
    } else {
      // Create new item
      items.push({ type: 'subagent', subAgentId: group.subAgentId, subAgentType: group.subAgentType, messages: group.messages })
    }
    
    currentSubAgentGroup = null
  }
  
  for (const msg of messages) {
    // Skip tool messages - they're displayed within assistant messages
    if (msg.role === 'tool') continue
    
    // Detect context window boundary - insert divider when window changes
    // Only insert if we've seen a previous window (not for the first window)
    if (msg.contextWindowId && lastContextWindowId && msg.contextWindowId !== lastContextWindowId) {
      // Flush any pending groups before the divider
      flushCriteriaBuffer()
      flushSubAgentGroup()
      windowSequence++
      items.push({ type: 'context-divider', windowSequence })
    }
    lastContextWindowId = msg.contextWindowId
    
    // Check if this is a criteria-only message
    if (isCriteriaOnlyMessage(msg)) {
      // Flush sub-agent group first (criteria can't be part of sub-agent)
      flushSubAgentGroup()
      // Add all tool calls from this message to the buffer
      for (const tc of msg.toolCalls!) {
        criteriaBuffer.push(tc)
      }
      continue
    }
    
    // Not a criteria-only message - flush criteria buffer
    flushCriteriaBuffer()
    
    if (msg.subAgentId && msg.subAgentType) {
      // Part of a sub-agent run
      if (currentSubAgentGroup && currentSubAgentGroup.subAgentId === msg.subAgentId) {
        // Add to existing group
        currentSubAgentGroup.messages.push(msg)
      } else {
        // Start new group
        flushSubAgentGroup()
        currentSubAgentGroup = { subAgentId: msg.subAgentId, subAgentType: msg.subAgentType as 'verifier', messages: [msg] }
      }
    } else {
      // Regular message - flush any pending group
      flushSubAgentGroup()
      
      // Try to find a previous item for this message
      const previousItem = previousItemsByMessageId.get(msg.id)
      
      if (previousItem && previousItem.type === 'message' && previousItem.message === msg) {
        // Reuse the previous item (message reference is identical)
        items.push(previousItem)
      } else {
        // Create new item
        items.push({ type: 'message', message: msg })
      }
    }
  }
  
  // Flush final groups
  flushCriteriaBuffer()
  flushSubAgentGroup()
  
  return items
}
