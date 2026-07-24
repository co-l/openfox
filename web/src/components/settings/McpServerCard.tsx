import { Toggle } from '../shared/Toggle'
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
}: McpServerCardProps) {
  const name = server.name
  return (
    <div key={name} className="rounded border border-border bg-bg-tertiary overflow-hidden">
      <div className="flex items-center justify-between p-3 hover:bg-bg-primary/50 transition-colors">
        <div
          className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
          onClick={() => onToggleExpand(name)}
        >
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
          {tools.length === 0 ? (
            <div className="text-xs text-text-muted">No tools available</div>
          ) : (
            <div className="space-y-1">
              {tools.map((tool) => (
                <div key={tool.name} className="py-1">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1 mr-2">
                      <span className="text-xs text-text-primary font-mono">{tool.name}</span>
                      {tool.description && <span className="text-xs text-text-muted ml-2">{tool.description}</span>}
                    </div>
                    <span className="text-xs text-text-muted mr-2 flex-shrink-0">
                      {formatTokens(tool.estimatedTokens)}
                    </span>
                    <Toggle enabled={tool.enabled} onClick={() => onToolToggle(tool.name)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
