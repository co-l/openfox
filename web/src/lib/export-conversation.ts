import type { Message, Session, ToolCall } from '@shared/types.js'
import { authFetch } from './api'

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80)
}

function formatToolCalls(toolCalls: ToolCall[]): string[] {
  const result: string[] = []
  for (const tc of toolCalls) {
    result.push(`#### 🛠️ Tool: \`${tc.name}\``)
    if (tc.arguments && Object.keys(tc.arguments).length > 0) {
      result.push('```json\n' + JSON.stringify(tc.arguments, null, 2) + '\n```')
    }
    if (tc.result) {
      if (tc.result.success) {
        result.push('**Result (Success):**\n```\n' + (tc.result.output ?? '') + '\n```')
      } else {
        result.push(
          '**Result (Error):**\n```\n' +
            (tc.result.error ? `Error: ${tc.result.error}\n` : '') +
            (tc.result.output ?? '') +
            '\n```',
        )
      }
    }
    result.push('')
  }
  return result
}

function formatThinking(thinking: string): string {
  return (
    '> **Thinking:**\n' +
    thinking
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n') +
    '\n'
  )
}

function formatUserMessage(msg: Message, time: string): string[] {
  const lines: string[] = [`### 👤 User${time}\n`]
  if (msg.content) {
    lines.push(msg.content)
  }
  if (msg.attachments && msg.attachments.length > 0) {
    lines.push('\n**Attachments:**')
    for (const att of msg.attachments) {
      lines.push(`- ${att.filename || 'Attachment'} (${att.mimeType || 'unknown'})`)
    }
  }
  lines.push('\n')
  return lines
}

function formatAssistantMessage(msg: Message, label: string, time: string, suffix = ''): string[] {
  const lines: string[] = [`### 🤖 ${label}${suffix}${time}\n`]
  if (msg.thinkingContent) {
    lines.push(formatThinking(msg.thinkingContent))
  }
  if (msg.content) {
    lines.push(msg.content + '\n')
  }
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    lines.push(...formatToolCalls(msg.toolCalls))
  }
  return lines
}

function formatSystemMessage(msg: Message, time: string): string[] {
  const lines: string[] = [`### ⚙️ System${msg.messageKind ? ` (${msg.messageKind})` : ''}${time}\n`]
  if (msg.content) {
    lines.push(msg.content + '\n')
  }
  return lines
}

function formatSessionMetaLines(session: Partial<Session> | null): string[] {
  const meta: string[] = []
  if (session?.id) meta.push(`- **Session ID:** \`${session.id}\``)
  if (session?.createdAt) meta.push(`- **Created:** ${session.createdAt}`)
  if (session?.projectId) meta.push(`- **Project:** \`${session.projectId}\``)
  if (session?.workdir) meta.push(`- **Workdir:** \`${session.workdir}\``)
  if (session?.providerModel) {
    meta.push(`- **Model:** \`${session.providerModel}\`${session.providerId ? ` (${session.providerId})` : ''}`)
  }
  if (session?.mode) meta.push(`- **Mode:** \`${session.mode}\``)
  meta.push(`- **Exported At:** ${new Date().toISOString()}`)
  return meta
}

export function formatConversationMarkdown(session: Partial<Session> | null, messages: Message[]): string {
  const lines: string[] = []

  const title = session?.metadata?.title || session?.id || 'Conversation'
  lines.push(`# ${title}\n`)
  lines.push(...formatSessionMetaLines(session))
  lines.push('\n---\n')

  let currentWindowId: string | undefined

  for (const msg of messages) {
    if (msg.role === 'tool') continue

    if (msg.contextWindowId && currentWindowId && msg.contextWindowId !== currentWindowId) {
      lines.push('\n---\n*Context Compaction / Window Transition*\n---\n')
    }
    currentWindowId = msg.contextWindowId

    const time = msg.timestamp ? ` *(${msg.timestamp})*` : ''

    if (msg.role === 'user') {
      lines.push(...formatUserMessage(msg, time))
    } else if (msg.subAgentId || msg.subAgentType) {
      const agentLabel = msg.subAgentType ? `Sub-Agent [${msg.subAgentType}]` : 'Sub-Agent'
      const suffix = msg.subAgentId ? ` (\`${msg.subAgentId}\`)` : ''
      lines.push(...formatAssistantMessage(msg, agentLabel, time, suffix))
    } else if (msg.role === 'assistant') {
      lines.push(...formatAssistantMessage(msg, 'Assistant', time))
    } else if (msg.role === 'system' || msg.isSystemGenerated) {
      lines.push(...formatSystemMessage(msg, time))
    }
  }

  return lines.join('\n')
}

export function downloadFile(content: string, filename: string, mimeType = 'text/markdown;charset=utf-8'): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export async function exportConversation(
  sessionId: string,
  fallbackSession?: Partial<Session> | null,
  fallbackMessages?: Message[],
): Promise<void> {
  let session = fallbackSession ?? null
  let messages = fallbackMessages ?? []

  try {
    const res = await authFetch(`/api/sessions/${sessionId}?full=true`)
    if (res.ok) {
      const data = await res.json()
      if (data.session) session = data.session
      if (data.messages && Array.isArray(data.messages)) messages = data.messages
    }
  } catch (err) {
    console.warn('Failed to fetch full session history, using local fallback:', err)
  }

  const markdown = formatConversationMarkdown(session, messages)
  const rawTitle = session?.metadata?.title || sessionId
  const dateStr = new Date().toISOString().slice(0, 10)
  const filename = `${sanitizeFilename(rawTitle)}_${dateStr}.md`

  downloadFile(markdown, filename)
}

export function formatSubAgentConversationMarkdown(
  session: Partial<Session> | null,
  options: {
    subAgentType: string
    subAgentId?: string
    subAgentName?: string
    messages: Message[]
  },
): string {
  const { subAgentType, subAgentId, subAgentName, messages } = options
  const lines: string[] = []

  const agentLabel = subAgentName || subAgentType
  lines.push(`# Sub-Agent: ${agentLabel}\n`)
  if (subAgentId) lines.push(`- **Sub-Agent ID:** \`${subAgentId}\``)
  lines.push(`- **Sub-Agent Type:** \`${subAgentType}\``)
  if (session?.metadata?.title) lines.push(`- **Session Title:** ${session.metadata.title}`)
  lines.push(...formatSessionMetaLines(session))
  lines.push('\n---\n')

  for (const msg of messages) {
    if (msg.role === 'tool') continue

    const time = msg.timestamp ? ` *(${msg.timestamp})*` : ''

    if (msg.role === 'user') {
      lines.push(...formatUserMessage(msg, time))
    } else if (msg.role === 'assistant' || msg.subAgentId || msg.subAgentType) {
      lines.push(...formatAssistantMessage(msg, agentLabel, time))
    } else if (msg.role === 'system' || msg.isSystemGenerated) {
      lines.push(...formatSystemMessage(msg, time))
    }
  }

  return lines.join('\n')
}

export function exportSubAgentConversation(options: {
  session?: Partial<Session> | null
  subAgentType: string
  subAgentId?: string
  subAgentName?: string
  messages: Message[]
}): void {
  const { session = null, subAgentType, subAgentId, subAgentName, messages } = options
  const markdown = formatSubAgentConversationMarkdown(session, {
    subAgentType,
    subAgentId,
    subAgentName,
    messages,
  })

  const rawTitle = session?.metadata?.title || session?.id || 'session'
  const agentLabel = subAgentName || subAgentType
  const dateStr = new Date().toISOString().slice(0, 10)
  const filename = `${sanitizeFilename(rawTitle)}_${sanitizeFilename(agentLabel)}_${dateStr}.md`

  downloadFile(markdown, filename)
}
