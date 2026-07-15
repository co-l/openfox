import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'wouter'
import { useConfigStore, getBackendDisplayName, type Provider } from '../../stores/config'
import { useSessionStore } from '../../stores/session'
import { ProviderModal, providerFormPayload, type ProviderFormData } from '../shared/ProviderModal'
import { authFetch } from '../../lib/api'
import { ChevronDownIcon, ReloadIcon, CheckIcon, EditSmallIcon, StarIcon, StarFilledIcon } from '../shared/icons'

function formatContextWindow(context: number): string {
  if (context >= 1000000) return `${(context / 1000000).toFixed(1)}M`
  if (context >= 1000) return `${(context / 1000).toFixed(0)}K`
  return `${context}`
}

export function ProviderSelector() {
  const [, navigate] = useLocation()
  const currentSession = useSessionStore((state) => state.currentSession)
  const setSessionProvider = useSessionStore((state) => state.setSessionProvider)
  const [isOpen, setIsOpen] = useState(false)
  const [expandedProviderIds, setExpandedProviderIds] = useState<string[]>([])
  interface ModelWithConfig {
    id: string
    contextWindow: number
    source: 'backend' | 'user' | 'default'
  }
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

  // Derive effective provider and model: session override wins, else global default
  const sessionProviderId = currentSession?.providerId ?? null
  const sessionModel = currentSession?.providerModel ?? null
  const defaultProviderId = defaultModelSelection?.split('/')[0] ?? null
  const defaultModel = defaultModelSelection?.split('/').slice(1).join('/') ?? null

  const effectiveProviderId = sessionProviderId ?? defaultProviderId
  const effectiveModel = sessionModel ?? defaultModel
  const shortModelName = effectiveModel
    ? (effectiveModel.split('/').pop()?.replace(/-/g, ' ') ?? effectiveModel)
    : 'No model'
  const isSessionScoped = !!(currentSession && sessionModel)
  const differsFromDefault = isSessionScoped && sessionModel !== defaultModel

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

  // Check if a given provider/model pair is the session-active model
  const isSessionActive = (providerId: string, modelId: string): boolean => {
    if (!currentSession) return false
    return currentSession.providerId === providerId && currentSession.providerModel === modelId
  }

  // Check if a given provider/model pair is the global default
  const isDefault = (providerId: string, modelId: string): boolean => {
    if (!defaultModelSelection) return false
    return defaultModelSelection === `${providerId}/${modelId}`
  }

  const loadProviderModels = async (providerId: string) => {
    setLoadingModels(providerId)
    try {
      await refreshProviderModels(providerId)
    } catch {
      // Silently fail - will retry next time dropdown is opened
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

    if (currentSession) {
      // Session-scoped: persist provider choice to session (no model specified)
      setSessionProvider(provider.id, undefined)
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

  // Handle clicking a model name: set it for the session (if session exists) or globally
  const handleModelClick = async (providerId: string, newModel: string) => {
    if (currentSession) {
      // Optimistic update: immediately reflect the new model in the header
      useSessionStore.setState((state) => ({
        currentSession: state.currentSession ? { ...state.currentSession, providerId, providerModel: newModel } : null,
      }))
      // Session-scoped: persist model choice to session only
      setSessionProvider(providerId, newModel)
      setExpandedProviderIds([])
      setIsOpen(false)
      return
    }

    // No session: set globally as default via activateProvider (which persists defaultModelSelection)
    const success = await activateProvider(providerId)
    if (success) {
      setExpandedProviderIds([])
      setIsOpen(false)
    }
  }

  // Handle clicking the star icon: set as global default
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

  // If no providers configured, show simple model display
  function getVisibleModels(provider: Provider) {
    const hasSelected = provider.models.some((m) => m.selected)
    return hasSelected ? provider.models.filter((m) => m.selected) : provider.models
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
          <>
            <span className="text-sm text-accent-primary">{shortModelName}</span>
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
          <>
            <span className={`text-sm ${differsFromDefault ? 'text-accent-primary italic' : 'text-accent-primary'}`}>
              {shortModelName}
            </span>
            {differsFromDefault && (
              <span className="text-xs text-text-muted ml-0.5" title="Session-scoped model (different from default)">
                •
              </span>
            )}
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
        )}
        <ChevronDownIcon className={`w-3 h-3 text-text-muted transition-transform`} rotate={isOpen ? 180 : 0} />
      </button>

      {/* Unified Provider + Model Dropdown */}
      {isOpen && (
        <div className="absolute bottom-full right-0 mb-1 w-72 bg-bg-secondary border border-border rounded-lg shadow-lg z-50 overflow-hidden max-h-[80vh] overflow-y-auto">
          <div className="py-1">
            {providers.map((provider) => (
              <div key={provider.id}>
                <div
                  className={`px-3 py-2 flex items-center justify-between ${
                    provider.id === effectiveProviderId ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary'
                  } ${activating ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
                >
                  <div
                    onClick={() => !activating && handleProviderClick(provider)}
                    className="flex flex-col min-w-0 flex-1 cursor-pointer"
                  >
                    <span
                      className={`text-sm font-medium truncate ${
                        provider.id === effectiveProviderId ? 'text-accent-primary' : 'text-text-primary'
                      }`}
                    >
                      {provider.name}
                    </span>
                    <span className="text-xs text-text-muted truncate">
                      {provider.backend !== 'unknown' && getBackendDisplayName(provider.backend)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {Boolean(provider.authAdapter) &&
                      (authStates[provider.id] === 'connected' || provider.credentialRef ? (
                        <button
                          type="button"
                          onClick={(event) => handleDisconnectAccount(event, provider.id)}
                          disabled={authBusy === provider.id}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-accent-success/40 text-accent-success hover:bg-accent-success/10 disabled:opacity-50"
                          title="Disconnect provider account"
                        >
                          Connected
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(event) => handleConnectAccount(event, provider.id)}
                          disabled={authBusy === provider.id}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-accent-primary/40 text-accent-primary hover:bg-accent-primary/10 disabled:opacity-50"
                          title="Connect provider account"
                        >
                          {authBusy === provider.id
                            ? 'Starting…'
                            : authStates[provider.id] === 'error' || authStates[provider.id] === 'expired'
                              ? 'Retry'
                              : 'Connect'}
                        </button>
                      ))}
                    {provider.id === effectiveProviderId ? (
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
                        handleRefreshClick(e, provider.id)
                      }}
                      className="p-0.5 hover:bg-bg-tertiary rounded transition-colors"
                      title="Refresh models"
                    >
                      <ReloadIcon
                        className={`w-4 h-4 ${loadingModels === provider.id ? 'animate-spin' : ''} ${
                          provider.id === activeProviderId ? 'text-accent-primary' : 'text-text-muted'
                        }`}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleChevronClick(provider)
                      }}
                      className="p-0.5 hover:bg-bg-tertiary rounded transition-colors"
                      title="Show models"
                    >
                      <ChevronDownIcon
                        className={`w-4 h-4 transition-transform ${expandedProviderIds.includes(provider.id) ? 'rotate-180' : ''} ${
                          provider.id === activeProviderId ? 'text-accent-primary' : 'text-text-muted'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Model submenu - shown for expanded provider */}
                {expandedProviderIds.includes(provider.id) && (
                  <div className="bg-bg-primary border-t border-border max-h-40 overflow-y-auto">
                    {loadingModels === provider.id ? (
                      <div className="px-4 py-2 text-xs text-text-muted">Loading models...</div>
                    ) : provider.models?.length ? (
                      getVisibleModels(provider).map((modelConfig) => {
                        const isActive = isSessionActive(provider.id, modelConfig.id)
                        const isDef = isDefault(provider.id, modelConfig.id)
                        return (
                          <div
                            key={modelConfig.id}
                            className={`flex items-center px-4 py-1.5 text-sm hover:bg-bg-tertiary transition-colors group ${
                              loadingModels === 'activating' ? 'opacity-50 cursor-wait' : ''
                            } ${isActive ? 'text-accent-primary' : 'text-text-secondary'}`}
                          >
                            {/* Click on model name → session-scoped (or global if no session) */}
                            <button
                              type="button"
                              onClick={() => handleModelClick(provider.id, modelConfig.id)}
                              disabled={loadingModels === 'activating'}
                              className="flex-1 truncate text-left"
                            >
                              {modelConfig.name ??
                                modelConfig.id.split('/').pop()?.replace(/-/g, ' ') ??
                                modelConfig.id}
                            </button>

                            <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                              <span className="text-xs text-text-muted">
                                {formatContextWindow(modelConfig.contextWindow)}
                              </span>

                              {/* Star: filled = default, outline = click to set as default. Hidden when no session since model-name click already sets global default. */}
                              {currentSession && (
                                <button
                                  type="button"
                                  onClick={(e) => handleSetDefault(e, provider.id, modelConfig.id)}
                                  disabled={settingDefault}
                                  className="p-0.5 hover:bg-bg-tertiary rounded transition-colors disabled:opacity-40"
                                  title={isDef ? 'Default model' : 'Set as default model'}
                                >
                                  {isDef ? (
                                    <StarFilledIcon className="w-3.5 h-3.5 text-accent-warning" />
                                  ) : (
                                    <StarIcon className="w-3.5 h-3.5 text-text-muted hover:text-accent-warning" />
                                  )}
                                </button>
                              )}

                              {/* Edit button */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleEditModel(provider.id, modelConfig)
                                }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-bg-tertiary rounded transition-opacity"
                                title="Edit model context"
                              >
                                <EditSmallIcon className="w-3 h-3 text-text-muted" />
                              </button>

                              {/* Checkmark: session-active model */}
                              {isActive && (
                                <span className="text-accent-success flex-shrink-0" title="Session model">
                                  <CheckIcon className="w-3.5 h-3.5" />
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      <div className="px-4 py-2 text-xs text-text-muted">No models available</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="border-t border-border px-3 py-2">
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
