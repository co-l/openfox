import { useState, useEffect, useRef } from 'react'
import { authFetch } from '../../../lib/api'
import { useT } from '../../../hooks/useT'
import { Button } from '../../shared/Button'
import { Toggle } from '../../shared/Toggle'
import { Input } from '../../shared/Input'
import { mcpStatusColor, mcpStatusDot } from '../../../lib/mcp-utils'
import { SETTINGS_KEYS, setSetting, mcpServersResource, type McpServerInfo } from '../../../lib/resources'
import { useSetting } from '../../../hooks/useSetting'
import { useResource } from '../../../hooks/useResource'
import { useTestButton } from '../../../hooks/useTestButton'
import { CRUDListView } from '../CRUDListView'
import { useConfirmDialog, FormField, ErrorBanner } from '../CRUDModal'
import { Modal } from '../../shared/SelfContainedModal'
import { McpServerCard } from '../McpServerCard'

function parseKeyValueLines(text: string): Record<string, string> {
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

interface McpFormData {
  name: string
  transport: 'stdio' | 'http'
  command: string
  args: string
  env: string
  url: string
  headers: string
  oauth: boolean
  timeout: string
}

interface McpServerFormFieldsProps {
  formData: McpFormData
  onChange: (data: McpFormData) => void
}

function McpServerFormFields({ formData, onChange }: McpServerFormFieldsProps) {
  const t = useT()
  return (
    <>
      <div>
        <label className="block text-xs text-text-secondary mb-1">{t({ en: 'Transport', fr: 'Transport' })}</label>
        <div className="flex gap-1">
          <button
            onClick={() => onChange({ ...formData, transport: 'stdio' })}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              formData.transport === 'stdio'
                ? 'bg-accent-primary text-white'
                : 'bg-bg-tertiary text-text-secondary hover:bg-bg-primary'
            }`}
          >
            Stdio
          </button>
          <button
            onClick={() => onChange({ ...formData, transport: 'http' })}
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
            label={t({ en: 'Command', fr: 'Commande' })}
            value={formData.command}
            onChange={(v) => onChange({ ...formData, command: v })}
            placeholder="e.g. npx"
          />
          <FormField
            label={t({ en: 'Arguments', fr: 'Arguments' })}
            value={formData.args}
            onChange={(v) => onChange({ ...formData, args: v })}
            placeholder={t({ en: 'space-separated args', fr: 'arguments séparés par des espaces' })}
          />
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t({ en: 'Environment variables', fr: 'Variables d’environnement' })}{' '}
              <span className="text-text-muted">
                ({t({ en: 'KEY=VALUE, one per line', fr: 'KEY=VALEUR, une par ligne' })})
              </span>
            </label>
            <textarea
              value={formData.env}
              onChange={(e) => onChange({ ...formData, env: e.target.value })}
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
            onChange={(v) => onChange({ ...formData, url: v })}
            placeholder="e.g. https://mcp.example.com/mcp"
          />
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t({ en: 'Headers', fr: 'En-têtes' })}{' '}
              <span className="text-text-muted">
                ({t({ en: 'KEY=VALUE, one per line', fr: 'KEY=VALEUR, une par ligne' })})
              </span>
            </label>
            <textarea
              value={formData.headers}
              onChange={(e) => onChange({ ...formData, headers: e.target.value })}
              placeholder="X-API-Key=xxx"
              className="w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary"
              rows={3}
            />
          </div>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.oauth}
              onChange={(e) => onChange({ ...formData, oauth: e.target.checked })}
              className="mt-0.5"
            />
            <span className="text-xs text-text-secondary">
              {t({ en: 'Authorize with OAuth', fr: 'Autoriser avec OAuth' })}
              <span className="block text-text-muted">
                {t({
                  en: 'For servers that require a sign in rather than a static credential. Expand the server afterwards to authorize.',
                  fr: 'Pour les serveurs qui exigent une connexion plutôt qu’un identifiant statique. Développez ensuite le serveur pour autoriser.',
                })}
              </span>
            </span>
          </label>
        </>
      )}
      <FormField
        label={t({ en: 'Timeout (seconds)', fr: 'Délai d’expiration (secondes)' })}
        value={formData.timeout}
        onChange={(v) => onChange({ ...formData, timeout: v })}
        placeholder={t({ en: 'optional, e.g. 30', fr: 'facultatif, ex. 30' })}
      />
    </>
  )
}

interface McpOAuthPanelProps {
  serverName: string
  onChanged: () => void
}

const MCP_OAUTH_BUTTON_CLASS =
  'px-2 py-1 rounded text-xs font-medium text-text-muted hover:text-text-primary hover:bg-bg-primary transition-colors disabled:opacity-50'

function McpOAuthPanel({ serverName, onChanged }: McpOAuthPanelProps) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [redirectUri, setRedirectUri] = useState('')
  const [pasted, setPasted] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const bc = new BroadcastChannel('openfox-oauth')
    bc.onmessage = (e) => {
      if (e.data?.type === 'oauth-callback-complete') {
        setRedirectUri('')
      }
    }
    return () => bc.close()
  }, [])

  const endpoint = `/api/mcp/servers/${encodeURIComponent(serverName)}/oauth`

  const call = async (run: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await run()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const postJson = async (path: string, body?: unknown) => {
    const res = await authFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? t({ en: 'Request failed', fr: 'Échec de la requête' }))
    return data
  }

  const handleStart = () =>
    call(async () => {
      const data = await postJson(`${endpoint}/start`)
      if (data.status !== 'redirect') {
        onChanged()
        return
      }
      setRedirectUri(data.redirectUri ?? '')
      window.open(data.authorizationUrl, '_blank', 'noopener,noreferrer')
    })

  const handleComplete = () =>
    call(async () => {
      await postJson(`${endpoint}/complete`, { response: pasted })
      setPasted('')
      setRedirectUri('')
      onChanged()
    })

  const handleForget = () =>
    call(async () => {
      const res = await authFetch(endpoint, { method: 'DELETE' })
      if (!res.ok)
        throw new Error(
          t({ en: 'Could not clear the stored credentials', fr: 'Impossible d’effacer les identifiants enregistrés' }),
        )
      onChanged()
    })

  return (
    <div className="space-y-1.5 py-1">
      <div className="flex items-center gap-1">
        <button onClick={handleStart} disabled={busy} className={MCP_OAUTH_BUTTON_CLASS}>
          {t({ en: 'Authorize', fr: 'Autoriser' })}
        </button>
        <button onClick={handleForget} disabled={busy} className={MCP_OAUTH_BUTTON_CLASS}>
          {t({ en: 'Forget credentials', fr: 'Oublier les identifiants' })}
        </button>
      </div>
      {redirectUri && (
        <div className="space-y-1">
          <div className="text-xs text-text-muted">
            {t({
              en: 'A tab opened for you to sign in. If it ends up on a page that will not load, copy the whole address from it and paste it below.',
              fr: 'Un onglet s’est ouvert pour vous connecter. S’il aboutit sur une page qui ne charge pas, copiez l’adresse complète depuis cet onglet et collez-la ci-dessous.',
            })}
          </div>
          <div className="text-xs text-text-muted font-mono break-all">{redirectUri}</div>
          <div className="flex items-center gap-1">
            <input
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={t({ en: 'paste the callback URL', fr: 'collez l’URL de rappel' })}
              className="flex-1 px-2 py-1 bg-bg-tertiary border border-border rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent-primary"
            />
            <button onClick={handleComplete} disabled={busy || !pasted} className={MCP_OAUTH_BUTTON_CLASS}>
              {t({ en: 'Finish', fr: 'Terminer' })}
            </button>
          </div>
        </div>
      )}
      {error && <div className="text-xs text-accent-error">{error}</div>}
    </div>
  )
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

function McpFormActions({
  saving,
  saveLabel,
  savingLabel,
  onCancel,
  onSave,
}: {
  saving: boolean
  saveLabel: string
  savingLabel: string
  onCancel: () => void
  onSave: () => void
}) {
  const t = useT()
  return (
    <div className="flex justify-end gap-2 pt-2 border-t border-border">
      <Button variant="secondary" onClick={onCancel} disabled={saving}>
        {t({ en: 'Cancel', fr: 'Annuler' })}
      </Button>
      <Button variant="primary" onClick={onSave} disabled={saving}>
        {saving ? savingLabel : saveLabel}
      </Button>
    </div>
  )
}

export function ToolsTab() {
  const t = useT()
  const searchEngineSetting = useSetting(SETTINGS_KEYS.SEARCH_ENGINE).value
  const tavilyKeySetting = useSetting(SETTINGS_KEYS.SEARCH_TAVILY_API_KEY).value
  const searxngUrlSetting = useSetting(SETTINGS_KEYS.SEARCH_SEARXNG_URL).value
  const searxngKeySetting = useSetting(SETTINGS_KEYS.SEARCH_SEARXNG_API_KEY).value
  const useRtkSetting = useSetting(SETTINGS_KEYS.TOOLS_USE_RTK).value
  const confirmWorkspaceSetting = useSetting(SETTINGS_KEYS.CONFIRM_ON_WORKSPACE_ACTIONS).value
  const shellSetting = useSetting(SETTINGS_KEYS.TOOLS_SHELL).value
  const perSessionMcpSetting = useSetting(SETTINGS_KEYS.FEATURES_PER_SESSION_MCP).value

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
    if (searchEngineSetting !== '') {
      setSearchEngine(searchEngineSetting)
      setTavilyKey(tavilyKeySetting)
      setSearxngUrl(searxngUrlSetting)
      setSearxngKey(searxngKeySetting)
    }
  }, [searchEngineSetting, tavilyKeySetting, searxngUrlSetting, searxngKeySetting])

  function handleEngineChange(engine: string) {
    setSearchEngine(engine)
    void setSetting(SETTINGS_KEYS.SEARCH_ENGINE, engine)
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

  // ── RTK availability ──
  const [rtkStatus, setRtkStatus] = useState<'checking' | 'available' | 'unavailable'>('checking')

  useEffect(() => {
    // Authorized transient read: one-shot RTK availability probe on mount.
    authFetch('/api/tools/rtk-check')
      .then((r) => r.json())
      .then((data) => setRtkStatus(data.available ? 'available' : 'unavailable'))
      .catch(() => setRtkStatus('unavailable'))
  }, [])

  // ── Shell selection (Windows only; empty list elsewhere) ──
  const [shells, setShells] = useState<{ id: string; label: string; available: boolean }[]>([])

  useEffect(() => {
    // Authorized transient read: one-shot shell discovery on mount.
    authFetch('/api/tools/shells')
      .then((r) => r.json())
      .then((data) => setShells(data.shells ?? []))
      .catch(() => setShells([]))
  }, [])

  const currentShell = shellSetting || 'cmd'

  // ── MCP state ──
  const { data: rawServers, loading, refresh: refreshServers } = useResource(mcpServersResource)
  const servers = rawServers ?? []
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingServer, setEditingServer] = useState<string | null>(null)
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set())
  const [formData, setFormData] = useState<McpFormData>({
    name: '',
    transport: 'stdio' as 'stdio' | 'http',
    command: '',
    args: '',
    env: '',
    url: '',
    headers: '',
    oauth: false,
    timeout: '',
  })
  const [formError, setFormError] = useState('')
  const [mcpError, setMcpError] = useState('')
  const [saving, setSaving] = useState(false)
  const { requestDelete, clearConfirm, isConfirming } = useConfirmDialog()

  const toggleExpand = (name: string) => {
    setExpandedServers((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
        return next
      }
      next.add(name)
      return next
    })
  }

  function validateTransportFields(): string | null {
    if (formData.transport === 'stdio' && !formData.command)
      return t({ en: 'Command is required for stdio transport', fr: 'La commande est requise pour le transport stdio' })
    if (formData.transport === 'http' && !formData.url)
      return t({ en: 'URL is required for HTTP transport', fr: 'L’URL est requise pour le transport HTTP' })
    if (formData.timeout) {
      const parsed = parseFloat(formData.timeout)
      if (isNaN(parsed) || parsed <= 0) {
        return t({ en: 'Timeout must be a positive number', fr: 'Le délai d’expiration doit être un nombre positif' })
      }
    }
    return null
  }

  function buildTransportBody(includeName: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = includeName
      ? { name: formData.name, transport: formData.transport }
      : { transport: formData.transport }
    if (formData.transport === 'stdio') {
      body.command = formData.command
      body.args = formData.args ? formData.args.split(' ').filter(Boolean) : []
      body.env = parseKeyValueLines(formData.env)
    } else {
      body.url = formData.url
      body.headers = parseKeyValueLines(formData.headers)
      body.oauth = formData.oauth
    }
    if (formData.timeout) {
      const parsed = parseFloat(formData.timeout)
      if (!isNaN(parsed) && parsed > 0) {
        body.timeout = parsed
      }
    }
    return body
  }

  const defaultFormData = {
    name: '',
    transport: 'stdio' as const,
    command: '',
    args: '',
    env: '',
    url: '',
    headers: '',
    oauth: false,
    timeout: '',
  }

  const handleAdd = async () => {
    setFormError('')
    if (!formData.name) {
      setFormError(t({ en: 'Name is required', fr: 'Le nom est requis' }))
      return
    }
    const transportError = validateTransportFields()
    if (transportError) {
      setFormError(transportError)
      return
    }
    setSaving(true)
    try {
      const body = buildTransportBody(true)
      const res = await authFetch('/api/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? t({ en: 'Failed to add server', fr: 'Échec de l’ajout du serveur' }))
      }
      setShowAddForm(false)
      setFormData(defaultFormData)
      await refreshServers()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (server: McpServerInfo) => {
    setFormData({
      name: server.name,
      transport: (server.config.transport as 'stdio' | 'http') ?? 'stdio',
      command: server.config.command ?? '',
      args: server.config.args?.join(' ') ?? '',
      env: server.config.env
        ? Object.entries(server.config.env)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n')
        : '',
      url: server.config.url ?? '',
      headers: server.config.headers
        ? Object.entries(server.config.headers)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n')
        : '',
      oauth: server.config.oauth ?? false,
      timeout: server.config.timeout !== undefined ? String(server.config.timeout) : '',
    })
    setFormError('')
    setEditingServer(server.name)
  }

  const handleUpdate = async () => {
    setFormError('')
    const transportError = validateTransportFields()
    if (transportError) {
      setFormError(transportError)
      return
    }
    setSaving(true)
    try {
      const body = buildTransportBody(false)
      const res = await authFetch(`/api/mcp/servers/${encodeURIComponent(editingServer!)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? t({ en: 'Failed to update server', fr: 'Échec de la mise à jour du serveur' }))
      }
      setEditingServer(null)
      setFormData(defaultFormData)
      await refreshServers()
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
        const data = await res.json().catch(() => ({}))
        throw new Error(
          (data as { error?: string }).error ??
            t({ en: 'Failed to remove server', fr: 'Échec de la suppression du serveur' }),
        )
      }
      clearConfirm()
      setMcpError('')
      await refreshServers()
    } catch (err) {
      setMcpError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleToggleTool = async (serverName: string, toolName: string, enabled: boolean) => {
    const previousServers = servers
    const optimisticServers = servers.map((s) => {
      if (s.name !== serverName) return s
      const tools = s.tools.map((t) => (t.name === toolName ? { ...t, enabled } : t))
      const estimatedTokens = tools.filter((t) => t.enabled).reduce((sum, t) => sum + t.estimatedTokens, 0)
      return { ...s, tools, estimatedTokens }
    })
    mcpServersResource.write(optimisticServers)

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
        const data = await res.json().catch(() => ({}))
        throw new Error(
          (data as { error?: string }).error ??
            t({ en: 'Failed to toggle tool', fr: 'Échec de l’activation/désactivation de l’outil' }),
        )
      }
      setMcpError('')
    } catch (err) {
      mcpServersResource.write(previousServers)
      setMcpError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleToggleServer = async (serverName: string, newDisabled: boolean) => {
    const previousServers = servers
    const optimisticServers = servers.map((s) => {
      if (s.name !== serverName) return s
      return { ...s, config: { ...s.config, disabled: newDisabled } }
    })
    mcpServersResource.write(optimisticServers)

    try {
      const res = await authFetch(`/api/mcp/servers/${encodeURIComponent(serverName)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: newDisabled }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(
          (data as { error?: string }).error ??
            t({ en: 'Failed to toggle server', fr: 'Échec de l’activation/désactivation du serveur' }),
        )
      }
      setMcpError('')
    } catch (err) {
      mcpServersResource.write(previousServers)
      setMcpError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-8">
      {/* ── Search Engine Section ── */}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">
          {t({ en: 'Search Engine', fr: 'Moteur de recherche' })}
        </h3>
        <p className="text-sm text-text-muted mb-3">
          {t({
            en: 'Configure a web search engine for the web_search tool.',
            fr: 'Configurez un moteur de recherche web pour l’outil web_search.',
          })}
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-primary mb-1">
              {t({ en: 'Engine', fr: 'Moteur' })}
            </label>
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
                  {engine || t({ en: 'Off', fr: 'Désactivé' })}
                </button>
              ))}
            </div>
          </div>
          {searchEngine === 'tavily' && (
            <div>
              <label className="block text-xs font-medium text-text-primary mb-1">
                {t({ en: 'Tavily API Key', fr: 'Clé API Tavily' })}
              </label>
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
                {t({ en: 'Get a free API key at', fr: 'Obtenez une clé API gratuite sur' })}{' '}
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
                <label className="block text-xs font-medium text-text-primary mb-1">
                  {t({ en: 'SearXNG URL', fr: 'URL SearXNG' })}
                </label>
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
                  {t({ en: 'API Key', fr: 'Clé API' })}{' '}
                  <span className="text-text-muted">({t({ en: 'optional', fr: 'facultatif' })})</span>
                </label>
                <Input
                  type="password"
                  value={searxngKey}
                  onChange={(e) => setSearxngKey(e.target.value)}
                  placeholder={t({ en: 'Optional API key', fr: 'Clé API facultative' })}
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

      {shells.length > 0 && (
        <>
          <hr className="border-border" />

          {/* ── Shell Section (Windows) ── */}
          <div>
            <h3 className="text-sm font-medium text-text-primary mb-3">{t({ en: 'Shell', fr: 'Shell' })}</h3>
            <p className="text-sm text-text-muted mb-3">
              {t({
                en: 'Shell used to run agent commands and integrated terminals. Git Bash gives the agent a Unix-like toolset (grep, sed, ls…) and usually works better than cmd.exe.',
                fr: 'Shell utilisé pour exécuter les commandes de l’agent et les terminaux intégrés. Git Bash offre à l’agent un environnement de type Unix (grep, sed, ls…) et fonctionne généralement mieux que cmd.exe.',
              })}
            </p>
            <div className="flex gap-2">
              {shells.map((shell) => (
                <button
                  key={shell.id}
                  onClick={() => void setSetting(SETTINGS_KEYS.TOOLS_SHELL, shell.id)}
                  disabled={!shell.available}
                  title={
                    shell.available
                      ? undefined
                      : t({ en: 'Not found on this machine', fr: 'Introuvable sur cette machine' })
                  }
                  className={`px-3 py-1.5 rounded text-sm border transition-colors ${
                    currentShell === shell.id
                      ? 'bg-accent-primary/10 border-accent-primary text-accent-primary'
                      : shell.available
                        ? 'border-border text-text-muted hover:text-text-primary'
                        : 'border-border text-text-muted opacity-50 cursor-not-allowed'
                  }`}
                >
                  {shell.label}
                  {!shell.available && t({ en: ' (not found)', fr: ' (introuvable)' })}
                </button>
              ))}
            </div>
            <p className="text-xs text-text-muted mt-2">
              {t({
                en: 'Applies to new commands and newly opened terminals. Running terminals keep their current shell.',
                fr: 'S’applique aux nouvelles commandes et aux terminaux récemment ouverts. Les terminaux en cours conservent leur shell actuel.',
              })}
            </p>
          </div>
        </>
      )}

      <hr className="border-border" />

      {/* ── Token Optimization Section ── */}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">
          {t({ en: 'Token Optimization', fr: 'Optimisation des jetons' })}
        </h3>
        <p className="text-sm text-text-muted mb-3">
          {t({
            en: 'Reduce token consumption by filtering command output through RTK. See the',
            fr: 'Réduisez la consommation de jetons en filtrant la sortie des commandes via RTK. Voir le',
          })}{' '}
          <a
            href="https://github.com/rtk-ai/rtk"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-primary hover:underline"
          >
            README
          </a>{' '}
          {t({ en: 'for installation.', fr: 'pour l’installation.' })}
        </p>
        <div className="flex items-center justify-between py-2">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-primary">
                {t({ en: 'Enable RTK auto-rewrite', fr: 'Activer la réécriture automatique RTK' })}
              </span>
              {rtkStatus === 'checking' && (
                <span className="text-xs text-text-muted animate-pulse">
                  {t({ en: 'checking…', fr: 'vérification…' })}
                </span>
              )}
              {rtkStatus === 'available' && (
                <span className="text-xs text-accent-success">{t({ en: '● installed', fr: '● installé' })}</span>
              )}
              {rtkStatus === 'unavailable' && (
                <span className="text-xs text-accent-error">{t({ en: '○ not found', fr: '○ introuvable' })}</span>
              )}
            </div>
          </div>
          <Toggle
            enabled={useRtkSetting === 'true'}
            onClick={() => void setSetting(SETTINGS_KEYS.TOOLS_USE_RTK, useRtkSetting === 'true' ? 'false' : 'true')}
          />
        </div>
        {shells.length > 0 && useRtkSetting === 'true' && currentShell !== 'gitbash' && (
          <p className="text-xs text-accent-warning mt-1">
            {t({
              en: 'RTK only rewrites Unix-style commands — with this shell it will rarely apply and can break some commands. Git Bash is recommended.',
              fr: 'RTK ne réécrit que les commandes de type Unix — avec ce shell, il s’appliquera rarement et peut casser certaines commandes. Git Bash est recommandé.',
            })}
          </p>
        )}
      </div>

      <hr className="border-border" />

      {/* ── Agent Confirmations Section ── */}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">
          {t({ en: 'Agent Confirmations', fr: 'Confirmations de l’agent' })}
        </h3>
        <p className="text-sm text-text-muted mb-3">
          {t({
            en: 'Require confirmation for workspace changes and git mutations. When disabled, the agent proceeds without interruption.',
            fr: 'Exigez une confirmation pour les modifications de l’espace de travail et les mutations git. Lorsque désactivé, l’agent continue sans interruption.',
          })}
        </p>
        <div className="flex items-center justify-between py-2">
          <div className="flex-1">
            <span className="text-sm text-text-primary">
              {t({ en: 'Confirm on workspace & git actions', fr: 'Confirmer les actions workspace et git' })}
            </span>
          </div>
          <Toggle
            enabled={confirmWorkspaceSetting === 'true'}
            onClick={() =>
              void setSetting(
                SETTINGS_KEYS.CONFIRM_ON_WORKSPACE_ACTIONS,
                confirmWorkspaceSetting === 'true' ? 'false' : 'true',
              )
            }
          />
        </div>
      </div>

      <hr className="border-border" />

      {/* ── MCP Servers Section ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-text-primary" data-testid="mcp-servers-heading">
            MCP Servers
          </h3>
          <Button variant="primary" size="sm" onClick={() => setShowAddForm(true)}>
            {t({ en: '+ Add Server', fr: '+ Ajouter un serveur' })}
          </Button>
        </div>
        <p className="text-sm text-text-muted mb-3">
          {t({
            en: "MCP servers provide external tools that extend OpenFox's capabilities.",
            fr: 'Les serveurs MCP fournissent des outils externes qui étendent les capacités d’OpenFox.',
          })}
        </p>
        <div className="flex items-center justify-between py-2">
          <div className="flex-1">
            <span className="text-sm text-text-primary">
              {t({
                en: 'Show per-conversation MCP toggle in chat bar',
                fr: 'Afficher l’interrupteur MCP par conversation dans la barre de chat',
              })}
            </span>
          </div>
          <Toggle
            enabled={perSessionMcpSetting === 'true'}
            onClick={() =>
              void setSetting(
                SETTINGS_KEYS.FEATURES_PER_SESSION_MCP,
                perSessionMcpSetting === 'true' ? 'false' : 'true',
              )
            }
          />
        </div>
        {mcpError && <ErrorBanner message={mcpError} />}

        <CRUDListView
          loading={loading}
          hasItems={servers.length > 0}
          loadingLabel={t({ en: 'Loading MCP servers...', fr: 'Chargement des serveurs MCP…' })}
          emptyLabel={t({ en: 'No MCP servers configured.', fr: 'Aucun serveur MCP configuré.' })}
        >
          {servers.map((server) => {
            const actions = expandedServers.has(server.name) ? (
              isConfirming(server.name, 'delete') ? (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemove(server.name)
                    }}
                    className="px-2 py-1 rounded text-xs font-medium hover:opacity-90 transition-colors bg-accent-error/20 text-accent-error hover:bg-accent-error/30"
                  >
                    {t({ en: 'Delete', fr: 'Supprimer' })}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      clearConfirm()
                    }}
                    className="px-2 py-1 rounded text-xs text-text-muted hover:bg-bg-primary transition-colors"
                  >
                    {t({ en: 'Cancel', fr: 'Annuler' })}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleEdit(server)
                    }}
                    className="px-2 py-1 rounded text-xs font-medium text-text-muted hover:text-text-primary hover:bg-bg-primary transition-colors"
                  >
                    {t({ en: 'Edit', fr: 'Modifier' })}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      requestDelete(server.name)
                    }}
                    className="px-2 py-1 rounded text-xs font-medium text-accent-error/80 hover:text-accent-error hover:bg-accent-error/10 transition-colors"
                  >
                    {t({ en: 'Remove', fr: 'Supprimer' })}
                  </button>
                </>
              )
            ) : null

            const errorEl =
              server.status === 'error' && server.error ? (
                <span className="text-xs text-accent-error truncate max-w-[200px]" title={server.error}>
                  {server.error}
                </span>
              ) : null

            return (
              <McpServerCard
                key={server.name}
                server={server}
                expanded={expandedServers.has(server.name)}
                onToggleExpand={toggleExpand}
                serverToggleEnabled={!server.config.disabled}
                onServerToggle={() => handleToggleServer(server.name, !server.config.disabled)}
                tools={server.tools}
                onToolToggle={(toolName) =>
                  handleToggleTool(server.name, toolName, !server.tools.find((tool) => tool.name === toolName)?.enabled)
                }
                statusDot={mcpStatusDot(server.status)}
                statusColor={mcpStatusColor(server.status)}
                authPanel={
                  server.config.oauth ? <McpOAuthPanel serverName={server.name} onChanged={refreshServers} /> : null
                }
                actions={
                  <>
                    {errorEl}
                    {actions}
                  </>
                }
              />
            )
          })}
        </CRUDListView>

        {showAddForm && (
          <Modal
            isOpen={showAddForm}
            onClose={() => {
              setShowAddForm(false)
              setFormError('')
            }}
            title={t({ en: 'Add MCP Server', fr: 'Ajouter un serveur MCP' })}
            size="sm"
          >
            <div className="space-y-3">
              <FormField
                label={t({ en: 'Name', fr: 'Nom' })}
                value={formData.name}
                onChange={(v) => setFormData({ ...formData, name: v })}
                placeholder="e.g. filesystem"
              />

              <McpServerFormFields formData={formData} onChange={setFormData} />

              {formError && <ErrorBanner message={formError} />}
              <McpFormActions
                saving={saving}
                saveLabel={t({ en: 'Add', fr: 'Ajouter' })}
                savingLabel={t({ en: 'Adding...', fr: 'Ajout…' })}
                onCancel={() => {
                  setShowAddForm(false)
                  setFormError('')
                  setSaving(false)
                  setFormData(defaultFormData)
                }}
                onSave={handleAdd}
              />
            </div>
          </Modal>
        )}

        {editingServer !== null && (
          <Modal
            isOpen
            onClose={() => {
              setEditingServer(null)
              setFormError('')
            }}
            title={t(
              { en: 'Edit MCP Server: {{name}}', fr: 'Modifier le serveur MCP : {{name}}' },
              { name: editingServer },
            )}
            size="sm"
          >
            <div className="space-y-3">
              <McpServerFormFields formData={formData} onChange={setFormData} />

              {formError && <ErrorBanner message={formError} />}
              <McpFormActions
                saving={saving}
                saveLabel={t({ en: 'Save', fr: 'Enregistrer' })}
                savingLabel={t({ en: 'Saving...', fr: 'Enregistrement…' })}
                onCancel={() => {
                  setEditingServer(null)
                  setFormError('')
                  setSaving(false)
                  setFormData(defaultFormData)
                }}
                onSave={handleUpdate}
              />
            </div>
          </Modal>
        )}
      </div>
    </div>
  )
}
