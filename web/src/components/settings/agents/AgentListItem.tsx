import type { AgentInfo } from '../../../lib/agents-actions'
import { CRUDListItem } from '../CRUDListItem'
import { useT } from '../../../hooks/useT'

export function AgentListItem({
  agent,
  isBuiltIn,
  isConfirmingDelete,
  alwaysAllowedNames,
  model,
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
  model?: string
  onView: () => void
  onEdit?: () => void
  onDuplicate: () => void
  onDelete?: () => void
  onCancelDelete?: () => void
}) {
  const t = useT()
  const displayTools = agent.allowedTools.filter((t) => !alwaysAllowedNames?.has(t))
  const shortModel = model ? model.split('/').pop()?.replace(/-/g, ' ') : undefined
  return (
    <CRUDListItem
      isBuiltIn={isBuiltIn}
      isConfirmingDelete={isConfirmingDelete}
      onView={onView}
      onEdit={onEdit}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
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
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-primary text-text-muted">
            {t({ en: 'Built-in', fr: 'Intégré' })}
          </span>
        )}
        {shortModel && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent-primary/10 text-accent-primary">
            {shortModel}
          </span>
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
          <span className="text-[10px] text-text-muted">
            {t({ en: '+{{count}} more', fr: '+{{count}} de plus' }, { count: displayTools.length - 5 })}
          </span>
        )}
      </div>
    </CRUDListItem>
  )
}

export function AgentGroup({
  title,
  agentTitle = 'Agents',
  subagentTitle = 'Sub-agents',
  agents,
  subagents,
  isBuiltIn,
  alwaysAllowedNames,
  modelOverrides,
  onView,
  onDuplicate,
  onEdit,
  onDelete,
  onCancelDelete,
  isConfirmingDelete,
}: {
  title: string
  agentTitle?: string
  subagentTitle?: string
  agents: AgentInfo[]
  subagents: AgentInfo[]
  isBuiltIn: boolean
  alwaysAllowedNames?: Set<string>
  modelOverrides?: Record<string, string>
  onView: (id: string) => void
  onDuplicate: (id: string) => void
  onEdit?: (id: string) => void
  onDelete?: (id: string) => void
  onCancelDelete?: (id: string) => void
  isConfirmingDelete?: (id: string) => boolean
}) {
  if (agents.length === 0 && subagents.length === 0) return null
  const renderAgentItem = (agent: AgentInfo) => (
    <AgentListItem
      key={agent.id}
      agent={agent}
      model={modelOverrides?.[agent.id]}
      isBuiltIn={isBuiltIn}
      isConfirmingDelete={isConfirmingDelete?.(agent.id) ?? false}
      alwaysAllowedNames={alwaysAllowedNames}
      onView={() => onView(agent.id)}
      onEdit={onEdit ? () => onEdit(agent.id) : undefined}
      onDuplicate={() => onDuplicate(agent.id)}
      onDelete={isBuiltIn ? undefined : () => onDelete?.(agent.id)}
      onCancelDelete={isBuiltIn ? undefined : () => onCancelDelete?.(agent.id)}
    />
  )
  return (
    <div>
      <h3 className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wide">{title}</h3>
      {agents.length > 0 && <div className="text-xs text-text-muted uppercase tracking-wider mb-1.5">{agentTitle}</div>}
      <div className="space-y-2">
        {agents.map(renderAgentItem)}
        {subagents.length > 0 && (
          <div className="mt-3">
            <div className="text-xs text-text-muted uppercase tracking-wider mb-1.5">{subagentTitle}</div>
            <div className="space-y-2">{subagents.map(renderAgentItem)}</div>
          </div>
        )}
      </div>
    </div>
  )
}
