import { ScrollArea } from '../shared/ScrollArea'
import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'wouter'
import { useConfigStore, getBackendDisplayName, type Provider } from '../../stores/config'
import { useSessionStore } from '../../stores/session'
import { useSessionScope, useScopedPaneState } from '../../stores/session/session-scope'
import { useAgentsStore, getAgentColor } from '../../stores/agents'
import { ProviderModal, providerFormPayload, type ProviderFormData } from '../shared/ProviderModal'
import { authFetch } from '../../lib/api'
import { ChevronDownIcon, ReloadIcon, CheckIcon, SearchIcon } from '../shared/icons'
import { useKeybindings, useBinding } from '../../hooks/useKeybindings'
import { focusChatTextarea } from '../../lib/focusChatTextarea'
import { shouldAutofocus } from '../../lib/device'
import { useModelSearch, ModelEntryRow, type ModelWithConfig } from './model-list'

type ProviderLabelProps = {
  activeProvider: { name: string; isLocal?: boolean } | undefined
  shortModelName: string
  agentOverrideActive?: boolean
  agentColor?: string
  agentName?: string
}

function ProviderLabel({
  activeProvider,
  shortModelName,
  agentOverrideActive,
  agentColor,
  agentName,
}: ProviderLabelProps) {
  return (
    <>
      <span className="text-sm text-accent-primary flex items-center gap-1">
        {agentOverrideActive && (
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-border"
            style={{ backgroundColor: agentColor ?? '#6b7280' }}
            title={`Model set by agent "${agentName ?? 'unknown'}". Change it in Settings > Agents.`}
          />
        )}
        {activeProvider ? (
          <>
            <span className="hidden @sm:inline">{activeProvider.name} • </span>
            {shortModelName}
          </>
        ) : (
          shortModelName
        )}
      </span>
      <span
        className={`text-xs px-1.5 py-0.5 rounded-full ${
          activeProvider?.isLocal
            ? 'text-accent-success bg-accent-success/10'
            : 'text-accent-warning bg-accent-warning/10'
        }`}
      >
        {activeProvider?.isLocal ? 'local' : 'api'}
      </span>
    </>
  )
}

export function ProviderSelector() {
  const [, navigate] = useLocation()
  const sessionId = useSessionScope()
  const currentSession = useScopedPaneState(
    sessionId,
    (pane) => pane.session ?? null,
    (state) => state.currentSession,
    null,
  )
  const setSessionProvider = useSessionStore((state) => state.setSessionProvider)
  const [isOpen, setIsOpen] = useState(false)
  const [expandedProviderIds, setExpandedProviderIds] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [editingModel, setEditingModel] = useState<{ providerId: string; model: ModelWithConfig } | null>(null)
  const [showProviderModal, setShowProviderModal] = useState(false)
  const [authStates, setAuthStates] = useState<
    Record<string, 'disconnected' | 'pending' | 'connected' | 'expired' | 'error'>
  >({})
  const [authBusy, setAuthBusy] = useState<string | null>(null)
  const [deviceChallenge, setDeviceChallenge] = useState<{
    providerId: string
    mode?: 'device' | 'browser' | 'external'
    verificationUrl: string
    directUrl?: string
    userCode?: string
    instructions: string
  } | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const codeCopiedTimerRef = useRef<number | null>(null)
  const [devicePageOpened, setDevicePageOpened] = useState(false)
  const loadedProvidersRef = useRef<Set<string>>(new Set())
  const providers = useConfigStore((state) => state.providers)
  const activeProviderId = useConfigStore((state) => state.activeProviderId)
  const defaultModelSelection = useConfigStore((state) => state.defaultModelSelection)
  const activating = useConfigStore((state) => state.activating)
  const activateProvider = useConfigStore((state) => state.activateProvider)
  const refreshModel = useConfigStore((state) => state.refreshModel)
  const refreshProviderModels = useConfigStore((state) => state.refreshProviderModels)
  const setDefaultModel = useConfigStore((state) => state.setDefaultModel)
  const fetchConfig = useConfigStore((state) => state.fetchConfig)

  const keybindings = useKeybindings()
  useBinding(keybindings.modelSelector, () => setIsOpen((prev) => !prev))

  // Derive effective provider and model:
  // Agent override takes precedence, then session, then global default
  const sessionProviderId = currentSession?.providerId ?? null
  const sessionModel = currentSession?.providerModel ?? null
  const defaultProviderId = defaultModelSelection?.split('/')[0] ?? null
  const defaultModel = defaultModelSelection?.split('/').slice(1).join('/') ?? null

  // Agent model override — sourced from the agents store (populated via fetchAgents)
  const agentDefaults = useAgentsStore((state) => state.defaults)
  const agentUserItems = useAgentsStore((state) => state.userItems)
  const modelOverrides = useAgentsStore((state) => state.modelOverrides)
  const currentAgentId = currentSession?.mode
  const currentAgent = currentAgentId
    ? (agentDefaults.find((a) => a.id === currentAgentId) ?? agentUserItems.find((a) => a.id === currentAgentId))
    : undefined
  const agentOverride = currentAgentId ? (modelOverrides[currentAgentId] ?? undefined) : undefined
  const agentOverrideProviderId = agentOverride ? (agentOverride.split('/')[0] ?? null) : null
  const agentOverrideModel = agentOverride ? (agentOverride.split('/').slice(1).join('/') ?? null) : null
  const agentColor = currentAgentId ? getAgentColor([...agentDefaults, ...agentUserItems], currentAgentId) : undefined

  const isAgentOverrideActive = !!agentOverride
  const effectiveProviderId = agentOverrideProviderId ?? sessionProviderId ?? defaultProviderId
  const effectiveModel = agentOverrideModel ?? sessionModel ?? defaultModel
  const shortModelName = effectiveModel
    ? (effectiveModel.split('/').pop()?.replace(/-/g, ' ') ?? effectiveModel)
    : 'No model'

  const [settingDefault, setSettingDefault] = useState(false)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setExpandedProviderIds([])
        loadedProvidersRef.current = new Set()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    return () => {
      if (codeCopiedTimerRef.current !== null) {
        window.clearTimeout(codeCopiedTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('')
      setHighlightedIndex(-1)
    }
  }, [isOpen])

  // Focus the search input when dropdown opens
  useEffect(() => {
    if (isOpen) {
      if (shouldAutofocus()) inputRef.current?.focus()
    }
  }, [isOpen])

  // Auto-expand all providers when menu opens and load their models (once per session)
  useEffect(() => {
    if (isOpen) {
      const allProviderIds = providers.map((p) => p.id)
      setExpandedProviderIds(allProviderIds)
      providers
        .filter((provider) => Boolean(provider.authAdapter))
        .forEach((provider) => void refreshAuthStatus(provider.id))
      allProviderIds.forEach((providerId) => {
        if (!loadedProvidersRef.current.has(providerId)) {
          loadedProvidersRef.current.add(providerId)
          loadProviderModels(providerId)
        }
      })
    }
  }, [isOpen, providers])

  useEffect(() => {
    if (!deviceChallenge) return

    let cancelled = false
    const checkConnection = async () => {
      const state = await refreshAuthStatus(deviceChallenge.providerId)
      if (cancelled) return

      if (state === 'connected') {
        setDeviceChallenge(null)
        setCodeCopied(false)
        setDevicePageOpened(false)
        await fetchConfig()
        loadedProvidersRef.current.delete(deviceChallenge.providerId)
        await loadProviderModels(deviceChallenge.providerId)
      }
    }

    void checkConnection()
    const interval = window.setInterval(() => void checkConnection(), 2000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [deviceChallenge])

  const activeProvider = providers.find((p) => p.id === effectiveProviderId)
  const isLlmOffline = activeProvider?.status === 'disconnected'

  const isSessionActive = (providerId: string, modelId: string): boolean => {
    if (!currentSession) return false
    return currentSession.providerId === providerId && currentSession.providerModel === modelId
  }

  const isDefault = (providerId: string, modelId: string): boolean => {
    if (!defaultModelSelection) return false
    return defaultModelSelection === `${providerId}/${modelId}`
  }

  const loadProviderModels = async (providerId: string) => {
    setLoadingModels(providerId)
    try {
      await refreshProviderModels(providerId)
    } catch {
      // Silently fail
    } finally {
      setLoadingModels(null)
    }
  }

  const toggleProviderExpansion = (provider: Provider) => {
    if (expandedProviderIds.includes(provider.id)) {
      setExpandedProviderIds(expandedProviderIds.filter((id) => id !== provider.id))
    } else {
      setExpandedProviderIds([...expandedProviderIds, provider.id])
      loadProviderModels(provider.id)
    }
  }

  const handleProviderClick = async (provider: Provider) => {
    if (provider.id === activeProviderId) {
      toggleProviderExpansion(provider)
      return
    }

    if (currentSession && sessionId) {
      setSessionProvider(sessionId, provider.id, undefined)
      setIsOpen(false)
      setExpandedProviderIds([])
    } else {
      const success = await activateProvider(provider.id)
      if (success) {
        setIsOpen(false)
        setExpandedProviderIds([])
      }
    }
  }

  const handleChevronClick = (provider: Provider) => {
    toggleProviderExpansion(provider)
  }

  const handleRefreshClick = async (e: React.MouseEvent, providerId: string) => {
    e.stopPropagation()
    loadedProvidersRef.current.delete(providerId)
    await loadProviderModels(providerId)
  }

  const refreshAuthStatus = async (providerId: string) => {
    const response = await authFetch(`/api/provider-auth/${providerId}/status`)
    if (!response.ok) return 'error' as const
    const data = (await response.json()) as { state: 'disconnected' | 'pending' | 'connected' | 'expired' | 'error' }
    setAuthStates((current) => ({ ...current, [providerId]: data.state }))
    return data.state
  }

  const handleConnectAccount = async (event: React.MouseEvent, providerId: string) => {
    event.stopPropagation()
    setAuthBusy(providerId)
    setAuthStates((current) => ({ ...current, [providerId]: 'pending' }))
    setCodeCopied(false)
    setDevicePageOpened(false)
    try {
      const response = await authFetch(`/api/provider-auth/${providerId}/login`, { method: 'POST' })
      if (!response.ok) throw new Error('Unable to start provider sign-in')
      const challenge = (await response.json()) as {
        mode?: 'device' | 'browser' | 'external'
        verificationUrl: string
        directUrl?: string
        userCode?: string
        instructions: string
      }
      setDeviceChallenge({ providerId, ...challenge })
    } catch {
      setAuthStates((current) => ({ ...current, [providerId]: 'error' }))
    } finally {
      setAuthBusy(null)
    }
  }

  const copyDeviceCode = async () => {
    if (!deviceChallenge?.userCode) return
    await navigator.clipboard?.writeText(deviceChallenge.userCode)
    if (codeCopiedTimerRef.current !== null) window.clearTimeout(codeCopiedTimerRef.current)
    setCodeCopied(false)
    requestAnimationFrame(() => setCodeCopied(true))
    codeCopiedTimerRef.current = window.setTimeout(() => {
      setCodeCopied(false)
      codeCopiedTimerRef.current = null
    }, 1500)
  }

  const openDeviceAuthorization = () => {
    if (!deviceChallenge) return
    window.open(deviceChallenge.directUrl ?? deviceChallenge.verificationUrl, '_blank', 'noopener,noreferrer')
    setDevicePageOpened(true)
  }

  const closeDeviceChallenge = () => {
    setDeviceChallenge(null)
    setCodeCopied(false)
    setDevicePageOpened(false)
  }

  const handleDisconnectAccount = async (event: React.MouseEvent, providerId: string) => {
    event.stopPropagation()
    setAuthBusy(providerId)
    try {
      const response = await authFetch(`/api/provider-auth/${providerId}/logout`, { method: 'POST' })
      if (!response.ok) throw new Error('Unable to disconnect provider account')
      setAuthStates((current) => ({ ...current, [providerId]: 'disconnected' }))
      await fetchConfig()
    } finally {
      setAuthBusy(null)
    }
  }

  const handleEditModel = (providerId: string, model: ModelWithConfig) => {
    setEditingModel({ providerId, model })
    setShowProviderModal(true)
  }

  const editingProvider = editingModel ? providers.find((p) => p.id === editingModel.providerId) : undefined

  const handleCloseEditModal = () => {
    setEditingModel(null)
    setShowProviderModal(false)
  }

  const handleProviderModalSave = async (formData: ProviderFormData) => {
    try {
      const res = await authFetch(`/api/providers/${formData.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(providerFormPayload(formData)),
      })
      if (!res.ok) throw new Error('Failed to update provider')
      await useConfigStore.getState().fetchConfig()
    } catch {
      // Silently fail
    }
    setEditingModel(null)
    setShowProviderModal(false)
  }

  const handleModelClick = async (providerId: string, newModel: string) => {
    // When user manually picks a model that differs from the agent override, clear the override
    // so their selection truly sticks (the server always prefers the override at runtime).
    if (currentAgentId && agentOverride && agentOverride !== `${providerId}/${newModel}`) {
      authFetch(`/api/agents/${currentAgentId}/model`, { method: 'DELETE' }).catch(() => {})
      // Optimistically update the store so the UI reflects the change immediately
      useAgentsStore.setState((state) => {
        const next = { ...state.modelOverrides }
        delete next[currentAgentId]
        return { modelOverrides: next }
      })
    }

    if (currentSession && sessionId) {
      useSessionStore.setState((state) => ({
        ...state,
        currentSession: state.currentSession ? { ...state.currentSession, providerId, providerModel: newModel } : null,
      }))
      setSessionProvider(sessionId, providerId, newModel)
      setExpandedProviderIds([])
      setIsOpen(false)
      focusChatTextarea()
      return
    }

    const success = await activateProvider(providerId)
    if (success) {
      setExpandedProviderIds([])
      setIsOpen(false)
      focusChatTextarea()
    }
  }

  const handleSetDefault = async (e: React.MouseEvent, providerId: string, modelId: string) => {
    e.stopPropagation()
    setSettingDefault(true)
    try {
      await setDefaultModel(providerId, modelId)
    } catch {
      // Silently fail
    } finally {
      setSettingDefault(false)
    }
  }

  const {
    searchQuery,
    setSearchQuery,
    highlightedIndex,
    setHighlightedIndex,
    visibleGroups,
    flatItems,
    handleSearchKeyDown,
    highlightedRef,
    inputRef,
  } = useModelSearch({
    providers,
    onSelect: handleModelClick,
    onEscape: () => setIsOpen(false),
    extraItemCount: 1,
  })

  const isManageHighlighted = highlightedIndex === flatItems.length

  const handleProviderSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && highlightedIndex === flatItems.length) {
      e.preventDefault()
      navigate('/onboarding')
      setIsOpen(false)
      return
    }
    handleSearchKeyDown(e)
  }

  if (providers.length === 0) {
    return (
      <button
        type="button"
        onClick={() => refreshModel()}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-bg-tertiary transition-colors group"
        title={isLlmOffline ? 'LLM server is offline. Click to retry.' : (shortModelName ?? 'Click to refresh model')}
      >
        {isLlmOffline ? (
          <span className="text-sm text-accent-error animate-pulse">LLM offline</span>
        ) : (
          <ProviderLabel
            activeProvider={activeProvider}
            shortModelName={shortModelName}
            agentOverrideActive={isAgentOverrideActive}
            agentColor={agentColor}
            agentName={currentAgent?.name}
          />
        )}
        <span className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">↻</span>
      </button>
    )
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-bg-tertiary transition-colors group"
        title="Click to switch provider or model"
      >
        {isLlmOffline ? (
          <span className="text-sm text-accent-error animate-pulse">offline</span>
        ) : (
          <ProviderLabel
            activeProvider={activeProvider}
            shortModelName={shortModelName}
            agentOverrideActive={isAgentOverrideActive}
            agentColor={agentColor}
            agentName={currentAgent?.name}
          />
        )}
        <ChevronDownIcon className={`w-3 h-3 text-text-muted transition-transform`} rotate={isOpen ? 180 : 0} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full right-0 mb-1 min-w-72 max-w-[100vw] bg-bg-secondary border border-border rounded-lg shadow-lg z-50 flex flex-col max-h-[80vh]">
          <div className="flex items-center gap-1 px-3 py-2 border-b border-border flex-shrink-0">
            <SearchIcon className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onInput={(e) => {
                setSearchQuery(e.currentTarget.value)
                setHighlightedIndex(-1)
              }}
              onKeyDown={handleProviderSearchKeyDown}
              placeholder="Search models..."
              className="bg-transparent border-none outline-none text-sm text-text-primary w-full placeholder:text-text-muted"
            />
          </div>
          <ScrollArea className="flex-1 min-h-0">
            <div>
              {visibleGroups.map((group) => {
                const isExpanded = searchQuery.trim().length > 0 || expandedProviderIds.includes(group.provider.id)
                return (
                  <div key={group.provider.id}>
                    <div
                      className={`px-3 py-2 flex items-center justify-between ${
                        group.provider.id === effectiveProviderId ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary'
                      } ${activating ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
                    >
                      <div
                        onClick={() => !activating && handleProviderClick(group.provider)}
                        className="flex flex-col min-w-0 flex-1 cursor-pointer"
                      >
                        <span
                          className={`text-sm font-medium truncate ${
                            group.provider.id === effectiveProviderId ? 'text-accent-primary' : 'text-text-primary'
                          }`}
                        >
                          {group.provider.name}
                        </span>
                        <span className="text-xs text-text-muted truncate">
                          {group.provider.backend !== 'unknown' && getBackendDisplayName(group.provider.backend)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {Boolean(group.provider.authAdapter) &&
                          (authStates[group.provider.id] === 'connected' || group.provider.credentialRef ? (
                            <button
                              type="button"
                              onClick={(event) => handleDisconnectAccount(event, group.provider.id)}
                              disabled={authBusy === group.provider.id}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-accent-success/40 text-accent-success hover:bg-accent-success/10 disabled:opacity-50"
                              title="Disconnect provider account"
                            >
                              Connected
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(event) => handleConnectAccount(event, group.provider.id)}
                              disabled={authBusy === group.provider.id}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-accent-primary/40 text-accent-primary hover:bg-accent-primary/10 disabled:opacity-50"
                              title="Connect provider account"
                            >
                              {authBusy === group.provider.id
                                ? 'Starting…'
                                : authStates[group.provider.id] === 'error' ||
                                    authStates[group.provider.id] === 'expired'
                                  ? 'Retry'
                                  : 'Connect'}
                            </button>
                          ))}
                        {group.provider.id === effectiveProviderId ? (
                          <span className="text-accent-success" title="Active provider">
                            <CheckIcon className="w-4 h-4" />
                          </span>
                        ) : (
                          <span className="w-4" />
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRefreshClick(e, group.provider.id)
                          }}
                          className="p-0.5 hover:bg-bg-tertiary rounded transition-colors"
                          title="Refresh models"
                        >
                          <ReloadIcon
                            className={`w-4 h-4 ${loadingModels === group.provider.id ? 'animate-spin' : ''} ${
                              group.provider.id === activeProviderId ? 'text-accent-primary' : 'text-text-muted'
                            }`}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleChevronClick(group.provider)
                          }}
                          className="p-0.5 hover:bg-bg-tertiary rounded transition-colors"
                          title="Show models"
                        >
                          <ChevronDownIcon
                            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''} ${
                              group.provider.id === activeProviderId ? 'text-accent-primary' : 'text-text-muted'
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <ScrollArea className="bg-bg-primary border-t border-border max-h-40">
                        {loadingModels === group.provider.id ? (
                          <div className="px-4 py-2 text-xs text-text-muted">Loading models...</div>
                        ) : group.models.length > 0 ? (
                          group.models.map((modelConfig) => {
                            const modelFlatIndex = flatItems.findIndex(
                              (fi) => fi.providerId === group.provider.id && fi.modelConfig.id === modelConfig.id,
                            )
                            const isHighlighted = modelFlatIndex === highlightedIndex
                            return (
                              <div
                                key={`${group.provider.id}/${modelConfig.id}`}
                                ref={isHighlighted ? highlightedRef : undefined}
                              >
                                <ModelEntryRow
                                  providerId={group.provider.id}
                                  modelConfig={modelConfig}
                                  isActive={isSessionActive(group.provider.id, modelConfig.id)}
                                  isDefault={isDefault(group.provider.id, modelConfig.id)}
                                  disabled={loadingModels === 'activating'}
                                  hasSession={!!currentSession}
                                  settingDefault={settingDefault}
                                  highlighted={isHighlighted}
                                  onModelClick={handleModelClick}
                                  onSetDefault={handleSetDefault}
                                  onEditModel={handleEditModel}
                                />
                              </div>
                            )
                          })
                        ) : (
                          <div className="px-4 py-2 text-xs text-text-muted">No models available</div>
                        )}
                      </ScrollArea>
                    )}
                  </div>
                )
              })}
              {visibleGroups.length === 0 && searchQuery.trim() && (
                <div className="px-4 py-3 text-sm text-text-muted text-center">No models match your search</div>
              )}
            </div>
          </ScrollArea>
          <div
            className={`border-t border-border px-3 py-2 ${isManageHighlighted ? 'bg-bg-tertiary' : ''} flex-shrink-0`}
          >
            <button onClick={() => navigate('/onboarding')} className="text-xs text-accent-primary hover:underline">
              Manage providers
            </button>
          </div>
        </div>
      )}
      {deviceChallenge && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="provider-device-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDeviceChallenge()
          }}
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-bg-secondary p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="provider-device-title" className="text-lg font-semibold text-text-primary">
                  Connect provider
                </h2>
                <p className="mt-1 text-sm text-text-muted">
                  Follow the provider instructions to complete authorization.
                </p>
              </div>
              <button
                type="button"
                onClick={closeDeviceChallenge}
                className="rounded px-2 py-1 text-xl leading-none text-text-muted hover:bg-bg-tertiary hover:text-text-primary"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {deviceChallenge.mode !== 'browser' ? (
              <>
                <button
                  type="button"
                  onClick={copyDeviceCode}
                  className="mt-6 w-full select-all rounded-lg border border-accent-primary/40 bg-bg-primary px-4 py-5 font-mono text-3xl font-semibold tracking-[0.2em] text-accent-primary hover:bg-bg-tertiary"
                  title="Copy code"
                >
                  {deviceChallenge.userCode ?? 'Continue'}
                </button>

                <div className="mt-3 text-center text-xs text-text-muted">
                  {codeCopied ? 'Copied to clipboard' : 'Click the code to copy it'}
                </div>

                <div className="mt-6 flex gap-3">
                  <button
                    type="button"
                    onClick={copyDeviceCode}
                    className="flex-1 rounded-lg border border-border px-4 py-2 text-sm text-text-primary hover:bg-bg-tertiary"
                  >
                    {codeCopied ? 'Copied' : 'Copy code'}
                  </button>
                  <button
                    type="button"
                    onClick={openDeviceAuthorization}
                    className="flex-1 rounded-lg bg-accent-primary px-4 py-2 text-sm font-medium text-text-primary hover:bg-accent-primary/90"
                  >
                    {devicePageOpened ? 'Reopen authorization' : 'Open authorization'}
                  </button>
                </div>

                <p className="mt-4 text-center text-xs text-text-muted">
                  {devicePageOpened
                    ? 'If the browser blocked or closed the tab, reopen authorization.'
                    : 'OpenFox stays open while you complete authorization in the other tab.'}
                </p>
              </>
            ) : (
              <>
                <p className="mt-6 text-sm text-text-secondary leading-relaxed bg-bg-primary p-4 rounded-lg border border-border">
                  {deviceChallenge.instructions}
                </p>

                <div className="mt-6 flex gap-3">
                  <button
                    type="button"
                    onClick={openDeviceAuthorization}
                    className="w-full rounded-lg bg-accent-primary px-4 py-2 text-sm font-medium text-text-primary hover:bg-accent-primary/90"
                  >
                    {devicePageOpened ? 'Reopen authorization' : 'Open authorization'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {editingModel && showProviderModal && (
        <ProviderModal
          isOpen={true}
          onClose={handleCloseEditModal}
          onSave={handleProviderModalSave}
          initialStep={2}
          editProvider={{
            id: editingModel.providerId,
            name: editingProvider?.name ?? '',
            url: editingProvider?.url ?? '',
            backend: editingProvider?.backend ?? 'unknown',
            apiKey: editingProvider?.apiKey,
            isLocal: editingProvider?.isLocal,
            thinkingField: editingProvider?.thinkingField,
            sendReasoningInMessages: editingProvider?.sendReasoningInMessages,
            authAdapter: editingProvider?.authAdapter,
            transportAdapter: editingProvider?.transportAdapter,
            models: editingProvider?.models,
          }}
          editModelId={editingModel.model.id}
        />
      )}
    </div>
  )
}
