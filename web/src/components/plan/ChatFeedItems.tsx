import { memo } from 'react'
import type { DisplayItem } from './groupMessages.js'
import { ChatMessage } from './ChatMessage'
import { AssistantMessage } from './AssistantMessage'
import { SubAgentContainer } from './SubAgentContainer'

const ITEM_CONTAINMENT_STYLE = { contentVisibility: 'auto', containIntrinsicSize: 'auto 200px' } as const

interface ChatFeedItemsProps {
  displayItems: DisplayItem[]
  highlightedMessageId?: string | null
  sessionId?: string | null
  showThinking?: boolean
  showVerboseToolOutput?: boolean
  showStats?: boolean
  showAgentDefinitions?: boolean
  showWorkflowBars?: boolean
}

function itemKey(item: DisplayItem): string {
  if (item.type === 'context-divider') return `ctx-${item.windowSequence}`
  if (item.type === 'subagent') return item.messages[0]?.id ?? item.subAgentId
  return item.message.id
}

export const ChatFeedItems = memo(function ChatFeedItems({
  displayItems,
  highlightedMessageId = null,
  sessionId,
  showThinking = true,
  showVerboseToolOutput = true,
  showStats = true,
  showAgentDefinitions = true,
  showWorkflowBars = true,
}: ChatFeedItemsProps) {
  return (
    <>
      {displayItems.map((item, index) => {
        if (item.type === 'context-divider') {
          return (
            <div key={itemKey(item)} data-item-index={index} className="flex items-center gap-2 feed-item px-2 md:px-4">
              <div className="flex-1 border-t border-border" />
              <span className="text-[10px] text-text-muted font-medium px-2">Earlier context summarized</span>
              <div className="flex-1 border-t border-border" />
            </div>
          )
        }

        if (item.type === 'subagent') {
          const groupIsStreaming = item.messages.some((m) => m.isStreaming)
          return (
            <div key={itemKey(item)} data-item-index={index} className="px-2 md:px-4" style={ITEM_CONTAINMENT_STYLE}>
              <SubAgentContainer
                messages={item.messages}
                subAgentType={item.subAgentType}
                subAgentId={item.subAgentId}
                isStreaming={groupIsStreaming}
              />
            </div>
          )
        }

        const message = item.message
        if (message.role === 'assistant') {
          return (
            <div key={itemKey(item)} data-item-index={index} className="px-2 md:px-4" style={ITEM_CONTAINMENT_STYLE}>
              <AssistantMessage
                message={message}
                showStats={showStats}
                showThinking={showThinking}
                showVerboseToolOutput={showVerboseToolOutput}
              />
            </div>
          )
        }

        const skipAutoPrompt = !showAgentDefinitions && message.messageKind === 'auto-prompt'
        const skipWorkflow =
          !showWorkflowBars && (message.messageKind === 'workflow-started' || message.messageKind === 'task-completed')
        if (skipAutoPrompt || skipWorkflow) {
          return null
        }

        return (
          <div key={itemKey(item)} data-item-index={index} className="px-2 md:px-4" style={ITEM_CONTAINMENT_STYLE}>
            <div
              data-message-id={message.id}
              className={highlightedMessageId === message.id ? 'rounded animate-highlight-fade' : undefined}
            >
              <ChatMessage
                message={message}
                messageId={message.id}
                sessionId={sessionId ?? undefined}
                isLastAssistantMessage={false}
              />
            </div>
          </div>
        )
      })}
    </>
  )
})
