import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDownIcon } from '../shared/icons'
import { Toggle } from '../shared/Toggle'
import { useMcpStore } from '../../stores/mcp'
import { useSessionStore } from '../../stores/session'
import { mcpStatusColor, mcpStatusDot, formatTokens } from '../../lib/mcp-utils'
import { authFetch } from '../../lib/api'
import { useClickOutside } from '../../hooks/useClickOutside'

export function McpSelector() {
  const servers = useMcpStore((s) => s.servers)
  const fetchServers = useMcpStore((s) => s.fetchServers)
  const currentSession = useSessionStore((s) => s.currentSession)
  const sessionId = currentSession?.id
  const [isOpen, setIsOpen] = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const [togglingServers, setTogglingServers] = useState<Set<string>>(new Set())
  const [sessionDisabledServers, setSessionDisabledServers] = useState<Set<string>>(new Set())
  const dropdownRef = useRef<HTMLDivElement>(null)

  const fetchSessionOverrides = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await authFetch(`/api/sessions/${sessionId}/mcp/overrides`)
      if (res.ok) {
        const data = await res.json()
        setSessionDisabledServers(new Set(data.disabledServers ?? []))
      }
    } catch {
      // ignore
    }
  }, [sessionId])

  const refresh = useCallback(async () => {
    await fetchServers()
    await fetchSessionOverrides()
  }, [fetchServers, fetchSessionOverrides])

  useEffect(() => {
    const handler = () => refresh()
    window.addEventListener('mcp-servers-changed', handler)
    return () => window.removeEventListener('mcp-servers-changed', handler)
  }, [refresh])

  useEffect(() => {
    fetchSessionOverrides()
  }, [fetchSessionOverrides])

  useEffect(() => {
    if (isOpen) {
      fetchSessionOverrides()
    }
  }, [isOpen, fetchSessionOverrides])

  useClickOutside(dropdownRef, () => setIsOpen(false))

  const isServerEffectiveDisabled = (server: { name: string }) => {
    return sessionDisabledServers.has(server.name)
  }

  const connected = servers.filter((s) => s.status === 'connected' && !isServerEffectiveDisabled(s))
  const connectedCount = connected.length
  const totalTokens = connected.reduce((sum, s) => sum + s.estimatedTokens, 0)

  const handleToggleServer = async (serverName: string, newDisabled: boolean) => {
    if (!sessionId) return
    setToggleError(null)
    setTogglingServers((prev) => new Set(prev).add(serverName))
    try {
      const newSet = new Set(sessionDisabledServers)
      if (newDisabled) {
        newSet.add(serverName)
      } else {
        newSet.delete(serverName)
      }
      const res = await authFetch(`/api/sessions/${sessionId}/mcp/overrides`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabledServers: Array.from(newSet) }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? 'Toggle failed')
      }
      setSessionDisabledServers(newSet)
      await fetchServers()
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : String(err))
    } finally {
      setTogglingServers((prev) => {
        const next = new Set(prev)
        next.delete(serverName)
        return next
      })
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-bg-tertiary transition-colors group"
        title={connectedCount > 0 ? `${connectedCount} MCP server(s) active` : 'No MCP server active'}
      >
        <span className="text-sm text-accent-primary whitespace-nowrap">
          {connectedCount > 0 ? `● ${connectedCount} MCP (${formatTokens(totalTokens)})` : 'MCP'}
        </span>
        <ChevronDownIcon className="w-3 h-3 text-text-muted transition-transform" rotate={isOpen ? 180 : 0} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full right-0 mb-1 min-w-72 max-w-[100vw] bg-bg-secondary border border-border rounded-lg shadow-lg z-50 flex flex-col max-h-[80vh]">
          <div className="overflow-y-auto flex-1 min-h-0">
            {servers.length === 0 ? (
              <div className="px-4 py-3 text-sm text-text-muted text-center">No MCP servers configured</div>
            ) : (
              servers.map((server) => {
                const effectiveDisabled = isServerEffectiveDisabled(server)
                const isToggling = togglingServers.has(server.name)
                return (
                  <div key={server.name}>
                    <div className="px-3 py-2 flex items-center justify-between hover:bg-bg-tertiary">
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`text-sm ${mcpStatusColor(effectiveDisabled ? 'disabled' : server.status)}`}>
                            {mcpStatusDot(effectiveDisabled ? 'disabled' : server.status)}
                          </span>
                          <span className="text-sm font-medium text-text-primary truncate">{server.name}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-text-muted ml-3.5">
                          <span>{server.tools.length} tools</span>
                          {server.estimatedTokens > 0 && <span>{formatTokens(server.estimatedTokens)} tokens</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isToggling && <span className="text-xs text-text-muted animate-pulse">...</span>}
                        <Toggle
                          enabled={!effectiveDisabled}
                          onClick={() => handleToggleServer(server.name, !effectiveDisabled)}
                        />
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
          <div className="border-t border-border px-3 py-2 flex-shrink-0">
            {toggleError ? (
              <div className="text-xs text-accent-error">{toggleError}</div>
            ) : (
              <span className="text-xs text-text-muted">{servers.length} server(s) configured</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
