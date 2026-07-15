import { useState, useEffect, useCallback, useRef } from 'react'
import { authFetch } from '../../../lib/api'
import { Button } from '../../shared/Button'
import { Toggle } from '../../shared/Toggle'
import { Input } from '../../shared/Input'
import { ChevronDownIcon } from '../../shared/icons'
import { SETTINGS_KEYS } from '../../../stores/settings'
import { useSettingsStoreState } from '../useSettingsStore'
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

function useDebouncedSave(
  value: string,
  settingsKey: string,
  setSetting: (key: string, value: string) => Promise<void>,
  delay = 250,
): void {
  const isInitialMount = useRef(true)

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }

    const timer = setTimeout(() => {
      setSetting(settingsKey, value)
    }, delay)

    return () => clearTimeout(timer)
  }, [value, settingsKey, delay, setSetting])
}

function useTestButton(): [
  string,
  string,
  boolean,
  (testFn: () => Promise<{ success: boolean; error?: string }>) => Promise<void>,
] {
  const [text, setText] = useState('Test')
  const [error, setError] = useState('')
  const [isSuccess, setIsSuccess] = useState(false)
  const test = useCallback(async (testFn: () => Promise<{ success: boolean; error?: string }>) => {
    setText('Testing...')
    setError('')
    setIsSuccess(false)
    try {
      const result = await testFn()
      if (result.success) {
        setText('Success')
        setIsSuccess(true)
        setTimeout(() => {
          setText('Test')
          setIsSuccess(false)
        }, 3000)
      } else {
        setError(result.error ?? 'Test failed')
        setText('Test')
      }
    } catch {
      setError('Connection error')
      setText('Test')
    }
  }, [])
  return [text, error, isSuccess, test]
}

export function ToolsTab() {
  const { settings, getSetting, setSetting } = useSettingsStoreState()

  // ── Search Engine state ──
  const [searchEngine, setSearchEngine] = useState('')
  const [tavilyKey, setTavilyKey] = useState('')
  const [searxngUrl, setSearxngUrl] = useState('')
  const [searxngKey, setSearxngKey] = useState('')

  useDebouncedSave(tavilyKey, SETTINGS_KEYS.SEARCH_TAVILY_API_KEY, setSetting)
  useDebouncedSave(searxngUrl, SETTINGS_KEYS.SEARCH_SEARXNG_URL, setSetting)
  useDebouncedSave(searxngKey, SETTINGS_KEYS.SEARCH_SEARXNG_API_KEY, setSetting)

  const [tavilyTestText, tavilyTestError, tavilyTestSuccess, testTavily] = useTestButton()
  const [searxngTestText, searxngTestError, searxngTestSuccess, testSearxng] = useTestButton()

  useEffect(() => {
    getSetting(SETTINGS_KEYS.SEARCH_ENGINE)
    getSetting(SETTINGS_KEYS.SEARCH_TAVILY_API_KEY)
    getSetting(SETTINGS_KEYS.SEARCH_SEARXNG_URL)
    getSetting(SETTINGS_KEYS.SEARCH_SEARXNG_API_KEY)
  }, [getSetting])

  useEffect(() => {
    if (settings[SETTINGS_KEYS.SEARCH_ENGINE] !== undefined) {
      setSearchEngine(settings[SETTINGS_KEYS.SEARCH_ENGINE] ?? '')
      setTavilyKey(settings[SETTINGS_KEYS.SEARCH_TAVILY_API_KEY] ?? '')
      setSearxngUrl(settings[SETTINGS_KEYS.SEARCH_SEARXNG_URL] ?? '')
      setSearxngKey(settings[SETTINGS_KEYS.SEARCH_SEARXNG_API_KEY] ?? '')
    }
  }, [settings])

  function handleEngineChange(engine: string) {
    setSearchEngine(engine)
    setSetting(SETTINGS_KEYS.SEARCH_ENGINE, engine)
  }

  function handleTestTavily() {
    testTavily(async () => {
      const res = await authFetch('/api/search/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: 'tavily', tavilyApiKey: tavilyKey || undefined }),
      })
      return res.json()
    })
  }

  function handleTestSearxng() {
    testSearxng(async () => {
      const res = await authFetch('/api/search/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engine: 'searxng',
          searxngUrl: searxngUrl || undefined,
          searxngApiKey: searxngKey || undefined,
        }),
      })
      return res.json()
    })
  }

  // ── MCP state ──
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
    <div className="space-y-8">
      {/* ── Search Engine Section ── */}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">Search Engine</h3>
        <p className="text-sm text-text-muted mb-3">Configure a web search engine for the web_search tool.</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-primary mb-1">Engine</label>
            <div className="flex gap-2">
              {(['', 'tavily', 'searxng'] as const).map((engine) => (
                <button
                  key={engine}
                  onClick={() => handleEngineChange(engine)}
                  className={`px-3 py-1.5 rounded text-sm border transition-colors ${
                    searchEngine === engine
                      ? 'bg-accent-primary/10 border-accent-primary text-accent-primary'
                      : 'border-border text-text-muted hover:text-text-primary'
                  }`}
                >
                  {engine || 'Off'}
                </button>
              ))}
            </div>
          </div>
          {searchEngine === 'tavily' && (
            <div>
              <label className="block text-xs font-medium text-text-primary mb-1">Tavily API Key</label>
              <div className="flex gap-2 items-center">
                <Input
                  type="password"
                  value={tavilyKey}
                  onChange={(e) => setTavilyKey(e.target.value)}
                  placeholder="tvly-..."
                  className="flex-1"
                />
                <Button
                  variant="secondary"
                  onClick={handleTestTavily}
                  style={tavilyTestSuccess ? { color: 'rgb(63, 185, 80)' } : undefined}
                >
                  {tavilyTestText}
                </Button>
              </div>
              {tavilyTestError && <p className="text-xs text-red-500 mt-1">{tavilyTestError}</p>}
              <p className="text-xs text-text-muted mt-1">
                Get a free API key at{' '}
                <a
                  href="https://app.tavily.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-primary hover:underline"
                >
                  tavily.com
                </a>
              </p>
            </div>
          )}
          {searchEngine === 'searxng' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-text-primary mb-1">SearXNG URL</label>
                <Input
                  type="url"
                  value={searxngUrl}
                  onChange={(e) => setSearxngUrl(e.target.value)}
                  placeholder="http://localhost:4000"
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-primary mb-1">
                  API Key <span className="text-text-muted">(optional)</span>
                </label>
                <Input
                  type="password"
                  value={searxngKey}
                  onChange={(e) => setSearxngKey(e.target.value)}
                  placeholder="Optional API key"
                  className="w-full"
                />
              </div>
              <Button
                variant="secondary"
                onClick={handleTestSearxng}
                style={searxngTestSuccess ? { color: 'rgb(63, 185, 80)' } : undefined}
              >
                {searxngTestText}
              </Button>
              {searxngTestError && <p className="text-xs text-red-500">{searxngTestError}</p>}
            </div>
          )}
        </div>
      </div>

      <hr className="border-border" />

      {/* ── MCP Servers Section ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-text-primary">MCP Servers</h3>
          <Button variant="primary" size="sm" onClick={() => setShowAddForm(true)}>
            + Add Server
          </Button>
        </div>
        <p className="text-sm text-text-muted mb-3">
          MCP servers provide external tools that extend OpenFox's capabilities.
        </p>

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
    </div>
  )
}
