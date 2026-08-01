import { useState } from 'react'
import { Toggle } from '../shared/Toggle'
import { ChevronDownIcon } from '../shared/icons'
import { formatTokens } from '../../lib/mcp-utils'
import type { McpServerInfo } from '../../stores/mcp'

interface McpServerCardTool {
  name: string
  description?: string
  estimatedTokens: number
  enabled: boolean
}

interface McpServerCardProps {
  server: McpServerInfo
  expanded: boolean
  onToggleExpand: (name: string) => void
  serverToggleEnabled: boolean
  onServerToggle: () => void
  tools: McpServerCardTool[]
  onToolToggle: (toolName: string) => void
  statusDot: string
  statusColor: string
  actions?: React.ReactNode
  authPanel?: React.ReactNode
}

export function McpServerCard({
  server,
  expanded,
  onToggleExpand,
  serverToggleEnabled,
  onServerToggle,
  tools,
  onToolToggle,
  statusDot,
  statusColor,
  actions,
  authPanel,
}: McpServerCardProps) {
  const [expandedDescs, setExpandedDescs] = useState<Set<string>>(new Set())
  const name = server.name
  return (
    <div key={name} className="rounded border border-border bg-bg-tertiary overflow-hidden">
      <div className="flex items-center justify-between p-3 hover:bg-bg-primary/50 transition-colors">
        <div className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer" onClick={() => onToggleExpand(name)}>
          <span className={`text-sm ${statusColor}`}>{statusDot}</span>
          <span className="text-sm font-medium text-text-primary">{name}</span>
          <span className="text-xs text-text-muted">{server.config.transport}</span>
          <span className="text-xs text-text-muted">({tools.length} tools)</span>
          <span className="text-xs text-text-muted">{formatTokens(server.estimatedTokens)} tokens</span>
        </div>
        <div className="flex items-center gap-2">
          <Toggle enabled={serverToggleEnabled} onClick={onServerToggle} />
          {actions}
          <span className="text-xs text-text-muted">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-1.5">
          {server.config.command && (
            <div className="text-xs text-text-muted font-mono">
              {server.config.command} {server.config.args?.join(' ') ?? ''}
            </div>
          )}
          {server.config.url && <div className="text-xs text-text-muted font-mono">{server.config.url}</div>}
          {authPanel}
          {tools.length === 0 ? (
            <div className="text-xs text-text-muted">No tools available</div>
          ) : (
            <div className="space-y-1">
              {tools.map((tool) => (
                <div key={tool.name} className="py-1">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1 mr-2">
                      <span className="text-xs text-text-primary font-mono">{tool.name}</span>
                      {tool.description && tool.description.length > 80 ? (
                        <button
                          onClick={() => {
                            const key = tool.name
                            setExpandedDescs((prev) => {
                              const next = new Set(prev)
                              if (next.has(key)) next.delete(key)
                              else next.add(key)
                              return next
                            })
                          }}
                          className="inline-flex items-center gap-0.5 text-xs text-text-muted hover:text-text-primary transition-colors ml-2"
                        >
                          <span className="truncate max-w-[300px]">{tool.description}</span>
                          <ChevronDownIcon
                            rotate={expandedDescs.has(tool.name) ? 180 : 0}
                            className="w-3 h-3 flex-shrink-0"
                          />
                        </button>
                      ) : tool.description ? (
                        <span className="text-xs text-text-muted ml-2">{tool.description}</span>
                      ) : null}
                    </div>
                    <span className="text-xs text-text-muted mr-2 flex-shrink-0">
                      {formatTokens(tool.estimatedTokens)}
                    </span>
                    <Toggle enabled={tool.enabled} onClick={() => onToolToggle(tool.name)} />
                  </div>
                  {tool.description && tool.description.length > 80 && expandedDescs.has(tool.name) && (
                    <div className="text-xs text-text-muted mt-1 ml-1">{tool.description}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
