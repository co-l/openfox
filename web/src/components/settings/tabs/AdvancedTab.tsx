import { useEffect, useState, useCallback, useRef } from 'react'
import { useLocation } from 'wouter'
import { Button } from '../../shared/Button'
import { Toggle } from '../../shared/Toggle'
import { Input } from '../../shared/Input'
import { SETTINGS_KEYS } from '../../../stores/settings'
import { authFetch } from '../../../lib/api'
import { useSettingsStoreState } from '../useSettingsStore'
import { RetryPatternsEditor, type RetryPatternsValue } from '../RetryPatternsEditor'

export function AdvancedTab({ onClose }: { onClose: () => void }) {
  const [, navigate] = useLocation()
  const { settings, getSetting, setSetting } = useSettingsStoreState()

  const showOpenInEditor = settings[SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR] === 'true'
  const dynamicSystemPrompt = settings[SETTINGS_KEYS.LLM_DYNAMIC_SYSTEM_PROMPT] === 'true'
  const cacheWarming = settings[SETTINGS_KEYS.CACHE_WARMING] === 'true'

  const [localToggles, setLocalToggles] = useState({
    openInEditor: showOpenInEditor,
    dynamicPrompt: dynamicSystemPrompt,
    cacheWarming,
  })

  const [retryPatterns, setRetryPatterns] = useState<RetryPatternsValue>({ patterns: [], maxRetriesPerTurn: 10 })

  const [searchEngine, setSearchEngine] = useState('')
  const [tavilyKey, setTavilyKey] = useState('')
  const [searxngUrl, setSearxngUrl] = useState('')
  const [searxngKey, setSearxngKey] = useState('')

  const [tavilySaveText, setTavilySaveText] = useState('Save')
  const [searxngUrlSaveText, setSearxngUrlSaveText] = useState('Save')
  const [searxngKeySaveText, setSearxngKeySaveText] = useState('Save')

  const [tavilyTestText, setTavilyTestText] = useState('Test')
  const [searxngTestText, setSearxngTestText] = useState('Test')
  const [tavilyTestError, setTavilyTestError] = useState('')
  const [searxngTestError, setSearxngTestError] = useState('')

  const searchLoaded = useRef(false)

  useEffect(() => {
    setLocalToggles({
      openInEditor: showOpenInEditor,
      dynamicPrompt: dynamicSystemPrompt,
      cacheWarming,
    })
  }, [showOpenInEditor, dynamicSystemPrompt, cacheWarming])

  useEffect(() => {
    getSetting(SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR)
    getSetting(SETTINGS_KEYS.LLM_DYNAMIC_SYSTEM_PROMPT)
    getSetting(SETTINGS_KEYS.CACHE_WARMING)
    getSetting(SETTINGS_KEYS.RETRY_PATTERNS)
    getSetting(SETTINGS_KEYS.SEARCH_ENGINE)
    getSetting(SETTINGS_KEYS.SEARCH_TAVILY_API_KEY)
    getSetting(SETTINGS_KEYS.SEARCH_SEARXNG_URL)
    getSetting(SETTINGS_KEYS.SEARCH_SEARXNG_API_KEY)
  }, [getSetting])

  useEffect(() => {
    const raw = settings[SETTINGS_KEYS.RETRY_PATTERNS]
    if (raw) {
      try {
        setRetryPatterns(JSON.parse(raw))
      } catch {
        // ignore parse errors
      }
    }
  }, [settings])

  // Load search settings once on first settings fetch, never overwrite local edits
  useEffect(() => {
    if (!searchLoaded.current && settings[SETTINGS_KEYS.SEARCH_ENGINE] !== undefined) {
      searchLoaded.current = true
      setSearchEngine(settings[SETTINGS_KEYS.SEARCH_ENGINE] ?? '')
      setTavilyKey(settings[SETTINGS_KEYS.SEARCH_TAVILY_API_KEY] ?? '')
      setSearxngUrl(settings[SETTINGS_KEYS.SEARCH_SEARXNG_URL] ?? '')
      setSearxngKey(settings[SETTINGS_KEYS.SEARCH_SEARXNG_API_KEY] ?? '')
    }
  }, [settings])

  const handleRetryPatternsChange = useCallback(
    (value: RetryPatternsValue) => {
      setRetryPatterns(value)
      setSetting(SETTINGS_KEYS.RETRY_PATTERNS, JSON.stringify(value))
    },
    [setSetting],
  )

  const handleToggleOpenInEditor = () => {
    const newValue = !localToggles.openInEditor
    setLocalToggles((prev) => ({ ...prev, openInEditor: newValue }))
    setSetting(SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR, String(newValue))
  }

  const handleToggleDynamicSystemPrompt = () => {
    const newValue = !localToggles.dynamicPrompt
    setLocalToggles((prev) => ({ ...prev, dynamicPrompt: newValue }))
    setSetting(SETTINGS_KEYS.LLM_DYNAMIC_SYSTEM_PROMPT, String(newValue))
  }

  const handleToggleCacheWarming = () => {
    const newValue = !localToggles.cacheWarming
    setLocalToggles((prev) => ({ ...prev, cacheWarming: newValue }))
    setSetting(SETTINGS_KEYS.CACHE_WARMING, String(newValue))
  }

  function handleLaunchOnboarding() {
    onClose()
    navigate('/onboarding')
  }

  function handleEngineChange(engine: string) {
    setSearchEngine(engine)
    setSetting(SETTINGS_KEYS.SEARCH_ENGINE, engine)
  }

  function handleSaveTavilyKey() {
    setSetting(SETTINGS_KEYS.SEARCH_TAVILY_API_KEY, tavilyKey)
    setTavilySaveText('Saved!')
    setTimeout(() => setTavilySaveText('Save'), 1500)
  }

  function handleSaveSearxngUrl() {
    setSetting(SETTINGS_KEYS.SEARCH_SEARXNG_URL, searxngUrl)
    setSearxngUrlSaveText('Saved!')
    setTimeout(() => setSearxngUrlSaveText('Save'), 1500)
  }

  function handleSaveSearxngKey() {
    setSetting(SETTINGS_KEYS.SEARCH_SEARXNG_API_KEY, searxngKey)
    setSearxngKeySaveText('Saved!')
    setTimeout(() => setSearxngKeySaveText('Save'), 1500)
  }

  async function handleTestTavily() {
    setTavilyTestText('Testing...')
    setTavilyTestError('')
    try {
      const res = await authFetch('/api/search/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: 'tavily', tavilyApiKey: tavilyKey || undefined }),
      })
      const data = await res.json()
      if (data.success) {
        setTavilyTestText('✓ OK')
        setTimeout(() => setTavilyTestText('Test'), 3000)
      } else {
        setTavilyTestError(data.error ?? 'Test failed')
        setTavilyTestText('Test')
      }
    } catch {
      setTavilyTestError('Connection error')
      setTavilyTestText('Test')
    }
  }

  async function handleTestSearxng() {
    setSearxngTestText('Testing...')
    setSearxngTestError('')
    try {
      const res = await authFetch('/api/search/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: 'searxng', searxngUrl: searxngUrl || undefined, searxngApiKey: searxngKey || undefined }),
      })
      const data = await res.json()
      if (data.success) {
        setSearxngTestText('✓ OK')
        setTimeout(() => setSearxngTestText('Test'), 3000)
      } else {
        setSearxngTestError(data.error ?? 'Test failed')
        setSearxngTestText('Test')
      }
    } catch {
      setSearxngTestError('Connection error')
      setSearxngTestText('Test')
    }
  }

  return (
    <div className="space-y-6">
      <SettingsToggle
        title="Dynamic System Prompt"
        description="Rebuild the system prompt on every turn. When disabled, changes are applied on demand via the context header for better cache performance."
        enabled={localToggles.dynamicPrompt}
        onToggle={handleToggleDynamicSystemPrompt}
        boldTitle
      />
      <hr className="border-border" />
      <SettingsToggle
        title="Speculative Cache Warming"
        description="On first keystroke in an empty session, prefill the LLM KV cache to reduce time-to-first-token."
        enabled={localToggles.cacheWarming}
        onToggle={handleToggleCacheWarming}
        boldTitle
      />
      <hr className="border-border" />
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">Auto-Retry Patterns</h3>
        <p className="text-xs text-text-muted mb-3">
          Define regex patterns that, when matched against LLM responses mid-stream, trigger an automatic retry with a
          "continue" prompt. The content that triggered the match is preserved in the chat feed.
        </p>
        <RetryPatternsEditor value={retryPatterns} onChange={handleRetryPatternsChange} />
      </div>
      <hr className="border-border" />
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">Integrations</h3>
        <SettingsToggle
          title='Show "Open in VSCode" links'
          description="Display a link on file reads to open the file directly in VS Code."
          enabled={localToggles.openInEditor}
          onToggle={handleToggleOpenInEditor}
        />
      </div>
      <hr className="border-border" />
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">Search Engine</h3>
        <p className="text-xs text-text-muted mb-3">
          Configure a web search engine for the <code className="text-accent-primary">web_search</code> tool.
          <strong>Off</strong> disables web search (the tool will prompt you to configure an engine).
          You can also set <code>TAVILY_API_KEY</code>, <code>SEARXNG_URL</code>, or <code>SEARXNG_API_KEY</code> as environment variables — these override UI settings.
        </p>
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
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={tavilyKey}
                  onChange={(e) => setTavilyKey(e.target.value)}
                  placeholder="tvly-..."
                  className="flex-1"
                />
                <Button variant="secondary" onClick={handleSaveTavilyKey}>
                  {tavilySaveText}
                </Button>
                <Button variant="secondary" onClick={handleTestTavily}>
                  {tavilyTestText}
                </Button>
              </div>
              {tavilyTestError && (
                <p className="text-xs text-red-500 mt-1">{tavilyTestError}</p>
              )}
              <p className="text-xs text-text-muted mt-1">
                Get a free API key at <span className="text-accent-primary">tavily.com</span>
              </p>
            </div>
          )}
          {searchEngine === 'searxng' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-text-primary mb-1">SearXNG URL</label>
                <div className="flex gap-2">
                  <Input
                    type="url"
                    value={searxngUrl}
                    onChange={(e) => setSearxngUrl(e.target.value)}
                    placeholder="http://localhost:4000"
                    className="flex-1"
                  />
                  <Button variant="secondary" onClick={handleSaveSearxngUrl}>
                    {searxngUrlSaveText}
                  </Button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-primary mb-1">
                  API Key <span className="text-text-muted">(optional)</span>
                </label>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={searxngKey}
                    onChange={(e) => setSearxngKey(e.target.value)}
                    placeholder="Optional API key"
                    className="flex-1"
                  />
                  <Button variant="secondary" onClick={handleSaveSearxngKey}>
                    {searxngKeySaveText}
                  </Button>
                </div>
              </div>
              <Button variant="secondary" onClick={handleTestSearxng}>
                {searxngTestText}
              </Button>
              {searxngTestError && (
                <p className="text-xs text-red-500">{searxngTestError}</p>
              )}
            </div>
          )}
        </div>
      </div>
      <hr className="border-border" />
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-1">Onboarding</h3>
        <p className="text-sm text-text-muted mb-4">
          Reset your OpenFox setup and go through the initial configuration again.
        </p>
        <Button variant="secondary" onClick={handleLaunchOnboarding}>
          Launch Onboarding
        </Button>
      </div>
    </div>
  )
}

function SettingsToggle({
  title,
  description,
  enabled,
  onToggle,
  boldTitle,
}: {
  title: string
  description: string
  enabled: boolean
  onToggle: () => void
  boldTitle?: boolean
}) {
  return (
    <label className="flex items-start justify-between gap-3 cursor-pointer">
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${boldTitle ? 'font-medium' : ''} text-text-primary`}>{title}</div>
        <div className="text-xs text-text-muted mt-0.5">{description}</div>
      </div>
      <div className="flex-shrink-0">
        <Toggle enabled={enabled} onClick={onToggle} />
      </div>
    </label>
  )
}
