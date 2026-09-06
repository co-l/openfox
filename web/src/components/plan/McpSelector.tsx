import { ScrollArea } from '../shared/ScrollArea'
import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDownIcon } from '../shared/icons'
import { Toggle } from '../shared/Toggle'
import { useT } from '../../hooks/useT'
import { useSessionStore } from '../../stores/session'
import { useResource } from '../../hooks/useResource'
import { mcpServersResource } from '../../lib/resources'
import { mcpStatusColor, mcpStatusDot, formatTokens } from '../../lib/mcp-utils'
import { authFetch } from '../../lib/api'
import { useClickOutside } from '../../hooks/useClickOutside'
import { useIsTouchDevice } from '../../hooks/useIsTouchDevice'
import { DropdownPanel } from '../shared/DropdownPanel'

export function McpSelector() {
  const t = useT()
  const isTouch = useIsTouchDevice()
  const { data: serversData, refresh: refreshServers } = useResource(mcpServersResource)
  const servers = serversData ?? []
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
      // Authorized transient read: session MCP overrides are refetched on the mcp-servers-changed event and on dropdown open, then merged into local state.
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
    await refreshServers()
    await fetchSessionOverrides()
  }, [refreshServers, fetchSessionOverrides])

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
      await refreshServers()
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
        title={
          connectedCount > 0
            ? t(
                { en: '{{count}} MCP server(s) active', fr: '{{count}} serveur(s) MCP actif(s)' },
                { count: connectedCount },
              )
            : t({ en: 'No MCP server active', fr: 'Aucun serveur MCP actif' })
        }
      >
        <span className="text-sm text-accent-primary whitespace-nowrap">
          {connectedCount > 0 ? `● ${connectedCount} MCP (${formatTokens(totalTokens)})` : 'MCP'}
        </span>
        <ChevronDownIcon className="w-3 h-3 text-text-muted transition-transform" rotate={isOpen ? 180 : 0} />
      </button>

      {isOpen && (
        <DropdownPanel
          isModal={isTouch}
          testId="mcp-dropdown"
          anchoredClassName="max-h-[80vh]"
          onClose={() => setIsOpen(false)}
        >
          <ScrollArea className="flex-1 min-h-0">
            {servers.length === 0 ? (
              <div className="px-4 py-3 text-sm text-text-muted text-center">
                {t({ en: 'No MCP servers configured', fr: 'Aucun serveur MCP configuré' })}
              </div>
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
                          <span>
                            {t({ en: '{{count}} tools', fr: '{{count}} outils' }, { count: server.tools.length })}
                          </span>
                          {server.estimatedTokens > 0 && (
                            <span>
                              {t(
                                { en: '{{count}} tokens', fr: '{{count}} jetons' },
                                { count: formatTokens(server.estimatedTokens) },
                              )}
                            </span>
                          )}
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
          </ScrollArea>
          <div className="border-t border-border px-3 py-2 flex-shrink-0">
            {toggleError ? (
              <div className="text-xs text-accent-error">{toggleError}</div>
            ) : (
              <span className="text-xs text-text-muted">
                {t(
                  { en: '{{count}} server(s) configured', fr: '{{count}} serveur(s) configuré(s)' },
                  { count: servers.length },
                )}
              </span>
            )}
          </div>
        </DropdownPanel>
      )}
    </div>
  )
}
