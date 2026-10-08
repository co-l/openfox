import type { StoredEvent } from '../events/types.js'

export interface InterruptedSubAgentInfo {
  subAgentId: string
  subAgentType: string
  prompt: string
  interruptedAt: number
}

export const CONTINUATION_REGEX =
  /\b(continue|resume|reprends|reprendre|poursuis|poursuivre|where you left off|left off)\b/i

export function findInterruptedSubAgentsFromEvents(events: StoredEvent[]): InterruptedSubAgentInfo[] {
  let startIdx = 0
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (event.type === 'chat.done') {
      const data = event.data as { agentType?: string; reason?: string }
      if (data.agentType !== 'sub-agent' && data.reason === 'complete') {
        startIdx = i + 1
        break
      }
    }
  }

  const subAgents = new Map<
    string,
    {
      subAgentId: string
      subAgentType: string
      prompt: string
      interruptedAt: number
    }
  >()

  const messageToSubAgent = new Map<string, string>()

  for (let i = startIdx; i < events.length; i++) {
    const event = events[i]!
    if (event.type === 'message.start') {
      const data = event.data as {
        messageId: string
        subAgentId?: string
        subAgentType?: string
        role?: string
        content?: string
        messageKind?: string
      }
      if (data.subAgentId) {
        messageToSubAgent.set(data.messageId, data.subAgentId)
        if (data.subAgentType) {
          let entry = subAgents.get(data.subAgentId)
          if (!entry) {
            entry = {
              subAgentId: data.subAgentId,
              subAgentType: data.subAgentType,
              prompt: data.content ?? '',
              interruptedAt: event.timestamp,
            }
            subAgents.set(data.subAgentId, entry)
          } else if (data.role === 'user' && data.content && (!entry.prompt || data.messageKind === 'auto-prompt')) {
            entry.prompt = data.content
          }
        }
      }
    }
  }

  const completedSubAgents = new Set<string>()

  for (let i = startIdx; i < events.length; i++) {
    const event = events[i]!
    if (event.type === 'tool.call') {
      const data = event.data as { messageId: string; toolCall: { id: string; name: string } }
      const subAgentId = messageToSubAgent.get(data.messageId)
      if (subAgentId && data.toolCall.name === 'return_value') {
        completedSubAgents.add(subAgentId)
      }
    } else if (event.type === 'chat.done') {
      const data = event.data as { agentType?: string; reason?: string; messageId?: string }
      if (data.agentType === 'sub-agent' && data.reason === 'complete' && data.messageId) {
        const subAgentId = messageToSubAgent.get(data.messageId)
        if (subAgentId) {
          completedSubAgents.add(subAgentId)
        }
      }
    }
  }

  const interrupted: InterruptedSubAgentInfo[] = []
  for (const [id, entry] of subAgents) {
    if (!completedSubAgents.has(id)) {
      interrupted.push({
        subAgentId: entry.subAgentId,
        subAgentType: entry.subAgentType,
        prompt: entry.prompt,
        interruptedAt: entry.interruptedAt,
      })
    }
  }

  return interrupted
}
