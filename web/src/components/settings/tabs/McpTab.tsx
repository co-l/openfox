import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '../../../lib/api'
import { Button } from '../../shared/Button'
import { Toggle } from '../../shared/Toggle'
import { ChevronDownIcon } from '../../shared/icons'
import { CRUDListHeader } from '../CRUDListHeader'
import { CRUDListView } from '../CRUDListView'
import { useConfirmDialog, FormField, ErrorBanner } from '../CRUDModal'
import { Modal } from '../../shared/SelfContainedModal'

interface McpToolInfo {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  enabled: boolean
  estimatedTokens: number
}

interface McpServerState {
  name: string
  config: { transport: string; command?: string; args?: string[]; url?: string; headers?: Record<string, string> }
  status: 'connected' | 'disconnected' | 'error'
  tools: McpToolInfo[]
  estimatedTokens: number
  error?: string
}

function formatTokens(n: number): string {
  if (n >= 1000) return `~${(n / 1000).toFixed(1)}K`
  return `~${n}`
}

export function McpTab() {
  const [servers, setServers] = useState<McpServerState[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set())
  const [expandedDescs, setExpandedDescs] = useState<Set<string>>(new Set())
  const [formData, setFormData] = useState({
    name: '',
    transport: 'stdio' as 'stdio' | 'http',
    command: '',
    args: '',
    env: '',
    url: '',
    headers: '',
  })
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const { requestDelete, clearConfirm, isConfirming } = useConfirmDialog()

  const loadServers = useCallback(async () => {
    try {
      const res = await authFetch('/api/mcp/servers')
      const data = await res.json()
      setServers(data.servers ?? [])
    } catch {
      /* ignore */
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadServers()
  }, [loadServers])

  useEffect(() => {
    const handler = () => loadServers()
    window.addEventListener('mcp-servers-changed', handler)
    return () => window.removeEventListener('mcp-servers-changed', handler)
  }, [loadServers])

  const toggleExpand = (name: string) => {
    setExpandedServers((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleAdd = async () => {
    setFormError('')
    if (!formData.name) {
      setFormError('Name is required')
      return
    }
    if (formData.transport === 'stdio' && !formData.command) {
      setFormError('Command is required for stdio transport')
      return
    }
    if (formData.transport === 'http' && !formData.url) {
      setFormError('URL is required for HTTP transport')
      return
    }
    setSaving(true)
    try {
      const parseKeyValueLines = (text: string): Record<string, string> => {
        const result: Record<string, string> = {}
        text
          .split('\n')
          .filter(Boolean)
          .forEach((line) => {
            const eqIdx = line.indexOf('=')
            if (eqIdx > 0) {
              result[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim()
            }
          })
        return result
      }

      const body: Record<string, unknown> = {
        name: formData.name,
        transport: formData.transport,
      }

      if (formData.transport === 'stdio') {
        body.command = formData.command
        const args = formData.args ? formData.args.split(' ').filter(Boolean) : undefined
        if (args && args.length > 0) body.args = args
        const env = parseKeyValueLines(formData.env)
        if (Object.keys(env).length > 0) body.env = env
      } else {
        body.url = formData.url
        const headers = parseKeyValueLines(formData.headers)
        if (Object.keys(headers).length > 0) body.headers = headers
      }

      const res = await authFetch('/api/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to add server')
      }
      setShowAddForm(false)
      setFormData({ name: '', transport: 'stdio', command: '', args: '', env: '', url: '', headers: '' })
      await loadServers()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async (name: string) => {
    try {
      const res = await authFetch(`/api/mcp/servers/${encodeURIComponent(name)}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        console.error('Failed to remove MCP server:', data.error)
      }
      clearConfirm()
      await loadServers()
    } catch (err) {
      console.error('Failed to remove MCP server:', err)
    }
  }

  const handleToggleTool = async (serverName: string, toolName: string, enabled: boolean) => {
    try {
      const res = await authFetch(
        `/api/mcp/servers/${encodeURIComponent(serverName)}/tools/${encodeURIComponent(toolName)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        },
      )
      if (!res.ok) {
        const data = await res.json()
        console.error('Failed to toggle tool:', data.error)
      }
      await loadServers()
    } catch (err) {
      console.error('Failed to toggle tool:', err)
    }
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'connected':
        return 'text-accent-success'
      case 'error':
        return 'text-accent-error'
      default:
        return 'text-text-muted'
    }
  }

  const statusDot = (status: string) => {
    switch (status) {
      case 'connected':
        return '●'
      case 'error':
        return '●'
      default:
        return '○'
    }
  }

  return (
    <div>
      <CRUDListHeader
        description="MCP servers provide external tools that extend OpenFox's capabilities."
        onNew={() => setShowAddForm(true)}
        newLabel="+ Add Server"
      />

      <CRUDListView
        loading={loading}
        hasItems={servers.length > 0}
        loadingLabel="Loading MCP servers..."
        emptyLabel="No MCP servers configured."
      >
        {servers.map((server) => (
          <div key={server.name} className="rounded border border-border bg-bg-tertiary overflow-hidden">
            <div
              className="flex items-center justify-between p-3 cursor-pointer hover:bg-bg-primary/50 transition-colors"
              onClick={() => toggleExpand(server.name)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-sm ${statusColor(server.status)}`}>{statusDot(server.status)}</span>
                <span className="text-sm font-medium text-text-primary">{server.name}</span>
                <span className="text-xs text-text-muted">{server.config.transport}</span>
                <span className="text-xs text-text-muted">({server.tools.length} tools)</span>
                <span className="text-xs text-text-muted">{formatTokens(server.estimatedTokens)} tokens</span>
              </div>
              <div className="flex items-center gap-2">
                {server.status === 'error' && server.error && (
                  <span className="text-xs text-accent-error truncate max-w-[200px]" title={server.error}>
                    {server.error}
                  </span>
                )}
                <span className="text-xs text-text-muted">{expandedServers.has(server.name) ? '▲' : '▼'}</span>
              </div>
            </div>

            {expandedServers.has(server.name) && (
              <div className="border-t border-border px-3 py-2 space-y-1.5">
                {server.config.command && (
                  <div className="text-xs text-text-muted font-mono">
                    {server.config.command} {server.config.args?.join(' ') ?? ''}
                  </div>
                )}
                {server.config.url && <div className="text-xs text-text-muted font-mono">{server.config.url}</div>}
                {server.tools.length === 0 ? (
                  <div className="text-xs text-text-muted">No tools available</div>
                ) : (
                  <div className="space-y-1">
                    {server.tools.map((tool) => (
                      <div key={tool.name} className="py-1">
                        <div className="flex items-center justify-between">
                          <div className="min-w-0 flex-1 mr-2">
                            <span className="text-xs text-text-primary font-mono">{tool.name}</span>
                            {tool.description && tool.description.length > 80 ? (
                              <button
                                onClick={() => {
                                  const key = `${server.name}:${tool.name}`
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
                                  rotate={expandedDescs.has(`${server.name}:${tool.name}`) ? 180 : 0}
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
                          <Toggle
                            enabled={tool.enabled}
                            onClick={() => handleToggleTool(server.name, tool.name, !tool.enabled)}
                          />
                        </div>
                        {tool.description &&
                          tool.description.length > 80 &&
                          expandedDescs.has(`${server.name}:${tool.name}`) && (
                            <div className="text-xs text-text-muted mt-1 ml-1">{tool.description}</div>
                          )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="pt-2 flex items-center justify-end gap-2">
                  {isConfirming(server.name, 'delete') ? (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemove(server.name)
                        }}
                        className="px-2 py-1 rounded text-xs font-medium hover:opacity-90 transition-colors bg-accent-error/20 text-accent-error hover:bg-accent-error/30"
                      >
                        Delete
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          clearConfirm()
                        }}
                        className="px-2 py-1 rounded text-xs text-text-muted hover:bg-bg-primary transition-colors"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        requestDelete(server.name)
                      }}
                      className="px-2 py-1 rounded text-xs font-medium text-accent-error/80 hover:text-accent-error hover:bg-accent-error/10 transition-colors"
                    >
                      Remove server
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </CRUDListView>

      {showAddForm && (
        <Modal
          isOpen={showAddForm}
          onClose={() => {
            setShowAddForm(false)
            setFormError('')
          }}
          title="Add MCP Server"
          size="sm"
        >
          <div className="space-y-3">
            <FormField
              label="Name"
              value={formData.name}
              onChange={(v) => setFormData({ ...formData, name: v })}
              placeholder="e.g. filesystem"
            />

            <div>
              <label className="block text-xs text-text-secondary mb-1">Transport</label>
              <div className="flex gap-1">
                <button
                  onClick={() => setFormData({ ...formData, transport: 'stdio' })}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                    formData.transport === 'stdio'
                      ? 'bg-accent-primary text-white'
                      : 'bg-bg-tertiary text-text-secondary hover:bg-bg-primary'
                  }`}
                >
                  Stdio
                </button>
                <button
                  onClick={() => setFormData({ ...formData, transport: 'http' })}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                    formData.transport === 'http'
                      ? 'bg-accent-primary text-white'
                      : 'bg-bg-tertiary text-text-secondary hover:bg-bg-primary'
                  }`}
                >
                  HTTP
                </button>
              </div>
            </div>

            {formData.transport === 'stdio' ? (
              <>
                <FormField
                  label="Command"
                  value={formData.command}
                  onChange={(v) => setFormData({ ...formData, command: v })}
                  placeholder="e.g. npx"
                />
                <FormField
                  label="Arguments"
                  value={formData.args}
                  onChange={(v) => setFormData({ ...formData, args: v })}
                  placeholder="space-separated args"
                />
                <div>
                  <label className="block text-xs text-text-secondary mb-1">
                    Environment variables <span className="text-text-muted">(KEY=VALUE, one per line)</span>
                  </label>
                  <textarea
                    value={formData.env}
                    onChange={(e) => setFormData({ ...formData, env: e.target.value })}
                    placeholder="API_KEY=xxx"
                    className="w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary"
                    rows={3}
                  />
                </div>
              </>
            ) : (
              <>
                <FormField
                  label="URL"
                  value={formData.url}
                  onChange={(v) => setFormData({ ...formData, url: v })}
                  placeholder="e.g. https://mcp.example.com/mcp"
                />
                <div>
                  <label className="block text-xs text-text-secondary mb-1">
                    Headers <span className="text-text-muted">(KEY=VALUE, one per line)</span>
                  </label>
                  <textarea
                    value={formData.headers}
                    onChange={(e) => setFormData({ ...formData, headers: e.target.value })}
                    placeholder="X-API-Key=xxx"
                    className="w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary"
                    rows={3}
                  />
                </div>
              </>
            )}

            {formError && <ErrorBanner message={formError} />}
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowAddForm(false)
                  setFormError('')
                  setSaving(false)
                  setFormData({ name: '', transport: 'stdio', command: '', args: '', env: '', url: '', headers: '' })
                }}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button variant="primary" onClick={handleAdd} disabled={saving}>
                {saving ? 'Adding...' : 'Add'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
