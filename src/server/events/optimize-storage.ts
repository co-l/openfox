/**
 * Storage optimization utilities for stripping bloated promptContext data.
 */

import type { SnapshotMessage } from './types.js'

/**
 * Strip the `messages` array from `promptContext` on all but the last assistant message.
 * Each promptContext.messages contains the full conversation history at that turn,
 * so storing it on every message causes O(n²) snapshot growth.
 * Mutates the array in place.
 * @returns true if any messages array was cleared
 */
export function stripPromptContextMessages(messages: SnapshotMessage[]): boolean {
  let lastAssistantIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg) continue
    if (msg.role === 'assistant' && msg.promptContext) {
      lastAssistantIdx = i
      break
    }
  }

  let changed = false
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg) continue
    const pc = msg.promptContext
    if (pc && pc.messages && pc.messages.length > 0 && i !== lastAssistantIdx) {
      pc.messages = []
      changed = true
    }
  }

  return changed
}