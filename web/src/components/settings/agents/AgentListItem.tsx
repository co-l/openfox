import { useState } from 'react'
import type { AgentInfo } from '../../../stores/agents'
import { CRUDListItem } from '../CRUDListItem'

export function AgentListItem({
  agent,
  isBuiltIn,
  isConfirmingDelete,
  alwaysAllowedNames,
  onView,
  onEdit,
  onDuplicate,
  onDelete,
  onCancelDelete,
}: {
  agent: AgentInfo
  isBuiltIn: boolean
  isConfirmingDelete: boolean
  alwaysAllowedNames?: Set<string>
  onView: () => void
  onEdit?: () => void
  onDuplicate: () => void
  onDelete?: () => void
  onCancelDelete?: () => void
}) {
  const displayTools = agent.allowedTools.filter((t) => !alwaysAllowedNames?.has(t))
  return (
    <CRUDListItem
      isBuiltIn={isBuiltIn}
      isConfirmingDelete={isConfirmingDelete}
      onView={onView}
      onEdit={onEdit}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
      deleteLabel={isBuiltIn ? 'Reset' : 'Delete'}
      onCancelDelete={onCancelDelete}
    >
      <div className="flex items-center gap-2">
        <span
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: agent.color ?? '#6b7280' }}
        />
        <span className="text-text-primary text-sm font-medium">{agent.name}</span>
        <span className="text-text-muted text-xs font-mono">{agent.id}</span>
        {isBuiltIn && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-primary text-text-muted">Built-in</span>
        )}
      </div>
      {agent.description && <p className="text-text-secondary text-xs mt-0.5 truncate">{agent.description}</p>}
      <div className="flex flex-wrap gap-1 mt-1">
        {displayTools.slice(0, 5).map((tool) => (
          <span key={tool} className="text-[10px] font-mono text-text-muted bg-bg-primary px-1 py-0.5 rounded">
            {tool}
          </span>
        ))}
        {displayTools.length > 5 && (
          <span className="text-[10px] text-text-muted">+{displayTools.length - 5} more</span>
        )}
      </div>
    </CRUDListItem>
  )
}

export function AgentGroup({
  title,
  agents,
  subagents,
  isBuiltIn,
  alwaysAllowedNames,
  onView,
  onDuplicate,
  onEdit,
  onDelete,
  canDelete,
}: {
  title: string
  agents: AgentInfo[]
  subagents: AgentInfo[]
  isBuiltIn: boolean
  alwaysAllowedNames?: Set<string>
  onView: (id: string) => void
  onDuplicate: (id: string) => void
  onEdit?: (id: string) => void
  onDelete?: (id: string) => void
  canDelete?: (id: string) => boolean
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  if (agents.length === 0 && subagents.length === 0) return null
  const renderAgentItem = (agent: AgentInfo) => (
    <AgentListItem
      key={agent.id}
      agent={agent}
      isBuiltIn={isBuiltIn}
      isConfirmingDelete={confirmingId === agent.id}
      alwaysAllowedNames={alwaysAllowedNames}
      onView={() => onView(agent.id)}
      onEdit={!isBuiltIn && onEdit ? () => onEdit(agent.id) : undefined}
      onDuplicate={() => onDuplicate(agent.id)}
      onCancelDelete={() => setConfirmingId(null)}
      onDelete={
        onDelete && (canDelete?.(agent.id) ?? true)
          ? () => {
              if (confirmingId === agent.id) {
                onDelete(agent.id)
                setConfirmingId(null)
              } else {
                setConfirmingId(agent.id)
              }
            }
          : undefined
      }
    />
  )
  return (
    <div>
      <h3 className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wide">{title}</h3>
      <div className="space-y-2">
        {agents.map(renderAgentItem)}
        {subagents.length > 0 && (
          <div className="mt-3">
            <div className="text-xs text-text-muted uppercase tracking-wider mb-1.5">Sub-agents</div>
            <div className="space-y-2">{subagents.map(renderAgentItem)}</div>
          </div>
        )}
      </div>
    </div>
  )
}
