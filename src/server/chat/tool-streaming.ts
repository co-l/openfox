/**
 * Tool streaming utilities
 * 
 * Handles conversion of tool onProgress callbacks to chat.tool_output events.
 * Used for streaming shell command output to the client in real-time.
 */

import type { ServerMessage } from '../../shared/protocol.js'
import { createChatToolOutputMessage } from '../ws/protocol.js'

export interface ParsedProgress {
  stream: 'stdout' | 'stderr'
  content: string
}

/**
 * Parse a progress message from the shell tool.
 * Shell tool emits messages in format: "[stdout] content" or "[stderr] content"
 * 
 * @returns Parsed progress or null if format doesn't match
 */
export function parseProgressMessage(message: string): ParsedProgress | null {
  const match = message.match(/^\[(stdout|stderr)\] (.*)$/s)
  if (!match) return null
  
  return {
    stream: match[1] as 'stdout' | 'stderr',
    content: match[2]!,
  }
}

/**
 * Create an onProgress handler that converts progress messages to chat.tool_output events.
 * 
 * @param messageId - The assistant message ID this tool call belongs to
 * @param callId - The tool call ID
 * @param onMessage - Callback to send server messages to the client
 * @returns Progress handler function to pass to tool context
 */
export function createToolProgressHandler(
  messageId: string,
  callId: string,
  onMessage: (msg: ServerMessage) => void
): (message: string) => void {
  return (message: string) => {
    const parsed = parseProgressMessage(message)
    if (!parsed) return
    
    onMessage(createChatToolOutputMessage(messageId, callId, parsed.content, parsed.stream))
  }
}
