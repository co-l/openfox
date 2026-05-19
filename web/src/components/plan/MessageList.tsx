import { memo, useMemo, type RefObject } from 'react'
import { useSessionStore, useIsRunning } from '../../stores/session'
import { useWorkflowsStore } from '../../stores/workflows'
import { useDisplaySettings } from '../../stores/settings'
import { ChatMessage } from './ChatMessage'
import { AssistantMessage } from './AssistantMessage'
import { SubAgentContainer } from './SubAgentContainer'
import { CriteriaGroupDisplay } from '../shared/CriteriaGroupDisplay'
import { CloseButton } from '../shared/CloseButton'
import { buildPromptContextByUserMessageId } from './prompt-context-linking.js'
import type { DisplayItem } from './groupMessages.js'

interface MessageListProps {
  displayItems: DisplayItem[]
  scrollContainerRef: RefObject<HTMLDivElement | null>
  highlightedMessageId: string | null
}

export const MessageList = memo(function MessageList({
  displayItems,
  scrollContainerRef,
  highlightedMessageId,
}: MessageListProps) {
  const criteria = useSessionStore((state) => state.currentSession?.criteria)
  const sessionId = useSessionStore((state) => state.currentSession?.id)
  const sessionMode = useSessionStore((state) => state.currentSession?.mode)
  const sessionPhase = useSessionStore((state) => state.currentSession?.phase)
  const rawMessages = useSessionStore((state) => state.messages)
  const error = useSessionStore((state) => state.error)
  const clearError = useSessionStore((state) => state.clearError)
  const acceptAndBuild = useSessionStore((state) => state.acceptAndBuild)
  const isRunning = useIsRunning()
  const { showThinking, showVerboseToolOutput, showStats, showAgentDefinitions, showWorkflowBars } =
    useDisplaySettings()

  const workflowDefaults = useWorkflowsStore((state) => state.defaults)
  const workflowUserItems = useWorkflowsStore((state) => state.userItems)
  const workflows = [...workflowDefaults, ...workflowUserItems]

  const promptContextByUserMessageId = useMemo(() => buildPromptContextByUserMessageId(rawMessages), [rawMessages])

  const isPlanning = sessionMode === 'planner'
  const hasCriteria = (criteria?.length ?? 0) > 0
  const isDone = sessionPhase === 'done'
  const hasAssistantResponse = displayItems.some((item) => item.type === 'message' && item.message.role === 'assistant')
  const showStartBuilding = isPlanning && hasCriteria && !isRunning && hasAssistantResponse && !isDone

  return (
    <div
      ref={scrollContainerRef}
      data-testid="chat-scroll-container"
      className="flex-1 min-w-0 overflow-y-auto relative bg-primary"
    >
      <div className="pt-4">
        {displayItems.map((item, index) => {
          if (item.type === 'context-divider') {
            return (
              <div key={index} data-item-index={index} className="flex items-center gap-2 feed-item px-2 md:px-4">
                <div className="flex-1 border-t border-border" />
                <span className="text-[10px] text-text-muted font-medium px-2">Earlier context summarized</span>
                <div className="flex-1 border-t border-border" />
              </div>
            )
          }

          if (item.type === 'subagent') {
            const groupIsStreaming = item.messages.some((m) => m.isStreaming)
            return (
              <div key={index} data-item-index={index} className="px-2 md:px-4">
                <SubAgentContainer
                  messages={item.messages}
                  subAgentType={item.subAgentType}
                  subAgentId={item.subAgentId}
                  isStreaming={groupIsStreaming}
                />
              </div>
            )
          }

          if (item.type === 'criteria-batch') {
            return (
              <div key={index} data-item-index={index} className="feed-item px-2 md:px-4">
                <CriteriaGroupDisplay toolCalls={item.toolCalls} criteria={criteria} />
              </div>
            )
          }

          const message = item.message
          if (message.role === 'assistant') {
            return (
              <div key={index} data-item-index={index} className="px-2 md:px-4">
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
            !showWorkflowBars &&
            (message.messageKind === 'workflow-started' || message.messageKind === 'task-completed')
          if (skipAutoPrompt || skipWorkflow) {
            return null
          }

          return (
            <div key={index} data-item-index={index} className="px-2 md:px-4">
              <div
                data-message-id={message.id}
                className={highlightedMessageId === message.id ? 'rounded animate-highlight-fade' : undefined}
              >
                <ChatMessage
                  message={message}
                  messageIndex={index}
                  sessionId={sessionId}
                  isLastAssistantMessage={false}
                  promptContext={message.role === 'user' ? promptContextByUserMessageId[message.id] : undefined}
                />
              </div>
            </div>
          )
        })}
      </div>
      <div className="px-2 md:px-4 pb-4">
        {error && (
          <div className="feed-item bg-red-500/10 border border-red-500/50 rounded p-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-red-400 text-sm font-medium">{error.code}</div>
                <div className="text-red-300 text-xs mt-0.5">{error.message}</div>
              </div>
              <CloseButton onClick={clearError} className="text-red-400 hover:text-red-300 p-0.5" size="sm" />
            </div>
          </div>
        )}

        {showStartBuilding && (
          <div className="flex justify-center gap-2 feed-item flex-wrap">
            {workflows.map((w) => {
              const c = w.color ?? '#3b82f6'
              const r = parseInt(c.slice(1, 3), 16),
                g = parseInt(c.slice(3, 5), 16),
                b = parseInt(c.slice(5, 7), 16)
              const bg = `rgba(${r},${g},${b},0.12)`
              const bgHover = `rgba(${r},${g},${b},0.22)`
              const border = `rgba(${r},${g},${b},0.25)`
              return (
                <button
                  key={w.id}
                  onClick={() => acceptAndBuild(w.id)}
                  data-testid="workflow-run-button"
                  className="px-4 py-1.5 rounded text-sm font-medium transition-colors"
                  style={{ backgroundColor: bg, color: c, border: `1px solid ${border}` }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = bgHover
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = bg
                  }}
                >
                  ▶ {w.name}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
})
