import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'wouter'
import { useConfigStore, getBackendDisplayName, type Provider } from '../../stores/config'
import { useSessionStore } from '../../stores/session'
import { ProviderModal, type ProviderFormData } from '../shared/ProviderModal'
import { authFetch } from '../../lib/api'
import { ChevronDownIcon, ReloadIcon, CheckIcon, EditSmallIcon } from '../shared/icons'

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
  const loadedProvidersRef = useRef<Set<string>>(new Set())

  const providers = useConfigStore((state) => state.providers)
  const activeProviderId = useConfigStore((state) => state.activeProviderId)
  const defaultModelSelection = useConfigStore((state) => state.defaultModelSelection)
  const activating = useConfigStore((state) => state.activating)
  const activateProvider = useConfigStore((state) => state.activateProvider)
  const refreshModel = useConfigStore((state) => state.refreshModel)
  const refreshProviderModels = useConfigStore((state) => state.refreshProviderModels)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setExpandedProviderIds([])
        // Reset loaded providers when closing
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
      // Load models for all providers (only once per provider per session)
      allProviderIds.forEach((providerId) => {
        if (!loadedProvidersRef.current.has(providerId)) {
          loadedProvidersRef.current.add(providerId)
          loadProviderModels(providerId)
        }
      })
    }
  }, [isOpen, providers])

  const activeProvider = providers.find((p) => p.id === activeProviderId)
  const isLlmOffline = activeProvider?.status === 'disconnected'

  // Parse defaultModelSelection for display and matching
  const selectedModel = defaultModelSelection ? (defaultModelSelection.split('/').pop() ?? null) : null
  const shortModelName = selectedModel
    ? (selectedModel.split('/').pop()?.replace(/-/g, ' ') ?? selectedModel)
    : 'detecting...'

  // Check if a given provider/model pair is the currently selected one
  const isSelected = (providerId: string, modelId: string): boolean => {
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

    // Switch to different provider
    if (currentSession) {
      // Session-scoped: persist provider choice to session (no model specified)
      setSessionProvider(provider.id, undefined)
      // Optimistically update UI with just the provider
      useConfigStore.getState().syncFromSession(provider.id, '')
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
    // Send PUT to update provider on server
    try {
      const res = await authFetch(`/api/providers/${formData.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          url: formData.url,
          backend: formData.backend,
          apiKey: formData.apiKey,
          isLocal: formData.isLocal,
          thinkingField: formData.thinkingField,
          models: formData.models,
        }),
      })
      if (!res.ok) throw new Error('Failed to update provider')
      // Persist per-model configs via individual POST calls
      for (const model of formData.models) {
        const settings: Record<string, unknown> = {}
        if (model.contextWindow !== undefined) settings.contextWindow = model.contextWindow
        if (model.supportsVision !== undefined) settings.supportsVision = model.supportsVision
        if (model.thinkingEnabled !== undefined) settings.thinkingEnabled = model.thinkingEnabled
        if (model.thinkingLevel !== undefined) settings.thinkingLevel = model.thinkingLevel
        if (model.nonThinkingEnabled !== undefined) settings.nonThinkingEnabled = model.nonThinkingEnabled
        if (model.thinkingExtraKwargs !== undefined) settings.thinkingExtraKwargs = model.thinkingExtraKwargs
        if (model.nonThinkingExtraKwargs !== undefined) settings.nonThinkingExtraKwargs = model.nonThinkingExtraKwargs
        if (Object.keys(settings).length > 0) {
          const modelRes = await authFetch(`/api/providers/${formData.id}/models/${encodeURIComponent(model.id)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings),
          })
          if (!modelRes.ok) throw new Error(`Failed to update model: ${model.id}`)
        }
      }
      // Refresh config to get updated providers
      await useConfigStore.getState().fetchConfig()
    } catch {
      // Silently fail
    }
    setEditingModel(null)
    setShowProviderModal(false)
  }

  const handleModelClick = async (providerId: string, newModel: string) => {
    if (currentSession) {
      // Session-scoped: persist model choice to session
      setSessionProvider(providerId, newModel)
      // Optimistically update UI
      useConfigStore.getState().syncFromSession(providerId, newModel)
      setExpandedProviderIds([])
      setIsOpen(false)
      return
    }

    setLoadingModels('activating')
    try {
      // Optimistically update UI
      useConfigStore.getState().syncFromSession(providerId, newModel)
      setExpandedProviderIds([])
      setIsOpen(false)

      const response = await authFetch(`/api/providers/${providerId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: newModel }),
      })
      if (response.ok) {
        const data = (await response.json()) as { activeProviderId: string; model: string; backend: string }
        useConfigStore.getState().syncFromSession(data.activeProviderId, data.model)
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingModels(null)
    }
  }

  // If no providers configured, show simple model display
  if (providers.length === 0) {
    return (
      <button
        type="button"
        onClick={() => refreshModel()}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-bg-tertiary transition-colors group"
        title={isLlmOffline ? 'LLM server is offline. Click to retry.' : (selectedModel ?? 'Click to refresh model')}
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
                    provider.id === activeProviderId ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary'
                  } ${activating ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
                >
                  <div
                    onClick={() => !activating && handleProviderClick(provider)}
                    className="flex flex-col min-w-0 flex-1 cursor-pointer"
                  >
                    <span
                      className={`text-sm font-medium truncate ${
                        provider.id === activeProviderId ? 'text-accent-primary' : 'text-text-primary'
                      }`}
                    >
                      {provider.name}
                    </span>
                    <span className="text-xs text-text-muted truncate">
                      {provider.backend !== 'auto' && getBackendDisplayName(provider.backend)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {provider.id === activeProviderId ? (
                      <span className="text-accent-success" title="Active">
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
                      provider.models.map((modelConfig) => (
                        <button
                          key={modelConfig.id}
                          type="button"
                          onClick={() => handleModelClick(provider.id, modelConfig.id)}
                          disabled={loadingModels === 'activating'}
                          className={`w-full px-4 py-1.5 text-left hover:bg-bg-tertiary transition-colors text-sm flex items-center justify-between group ${
                            loadingModels === 'activating' ? 'opacity-50 cursor-wait' : ''
                          } ${isSelected(provider.id, modelConfig.id) ? 'text-accent-primary' : 'text-text-secondary'}`}
                        >
                          <span className="truncate flex-1">
                            {modelConfig.id.split('/').pop()?.replace(/-/g, ' ') ?? modelConfig.id}
                          </span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-xs text-text-muted">
                              {formatContextWindow(modelConfig.contextWindow)}
                            </span>
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
                          </div>
                          {isSelected(provider.id, modelConfig.id) && (
                            <span className="text-accent-success flex-shrink-0 ml-1">
                              <CheckIcon className="w-3.5 h-3.5" />
                            </span>
                          )}
                        </button>
                      ))
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
            backend: editingProvider?.backend ?? 'auto',
            apiKey: editingProvider?.apiKey,
            isLocal: editingProvider?.isLocal,
            thinkingField: editingProvider?.thinkingField,
            models: editingProvider?.models,
          }}
          editModelId={editingModel.model.id}
        />
      )}
    </div>
  )
}
