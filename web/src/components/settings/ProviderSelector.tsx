import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'wouter'
import { useConfigStore, getBackendDisplayName, type Provider } from '../../stores/config'
import { useSessionStore } from '../../stores/session'
import { ModelPropertiesModal } from './ModelPropertiesModal'
import { authFetch } from '../../lib/api'

function formatContextWindow(context: number): string {
  if (context >= 1000000) return `${(context / 1000000).toFixed(1)}M`
  if (context >= 1000) return `${(context / 1000).toFixed(0)}K`
  return `${context}`
}

export function ProviderSelector() {
  const [, navigate] = useLocation()
  const currentSession = useSessionStore(state => state.currentSession)
  const setSessionProvider = useSessionStore(state => state.setSessionProvider)
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
  const loadedProvidersRef = useRef<Set<string>>(new Set())
  
  const providers = useConfigStore(state => state.providers)
  const activeProviderId = useConfigStore(state => state.activeProviderId)
  const model = useConfigStore(state => state.model)
  const backend = useConfigStore(state => state.backend)
  const llmStatus = useConfigStore(state => state.llmStatus)
  const activating = useConfigStore(state => state.activating)
  const activateProvider = useConfigStore(state => state.activateProvider)
  const refreshModel = useConfigStore(state => state.refreshModel)
  const refreshProviderModels = useConfigStore(state => state.refreshProviderModels)
  
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
      const allProviderIds = providers.map(p => p.id)
      setExpandedProviderIds(allProviderIds)
      // Load models for all providers (only once per provider per session)
      allProviderIds.forEach(providerId => {
        if (!loadedProvidersRef.current.has(providerId)) {
          loadedProvidersRef.current.add(providerId)
          loadProviderModels(providerId)
        }
      })
    }
  }, [isOpen, providers])

  const activeProvider = providers.find(p => p.id === activeProviderId)
  void activeProvider
  const isLlmOffline = llmStatus === 'disconnected'
  
  // Short model name for display
  const shortModelName = model
    ? model.split('/').pop()?.replace(/-/g, ' ') ?? model
    : 'detecting...'
  
  const backendName = getBackendDisplayName(backend)
  void isLlmOffline
  void backendName

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

  const handleProviderClick = async (provider: Provider) => {
    if (provider.id === activeProviderId) {
      // Toggle model expansion for active provider
      if (expandedProviderIds.includes(provider.id)) {
        setExpandedProviderIds(expandedProviderIds.filter(id => id !== provider.id))
      } else {
        // Show submenu immediately for instant feedback
        setExpandedProviderIds([...expandedProviderIds, provider.id])
        // Load models in background without blocking UI
        loadProviderModels(provider.id)
      }
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
    // Toggle model expansion for any provider
    if (expandedProviderIds.includes(provider.id)) {
      setExpandedProviderIds(expandedProviderIds.filter(id => id !== provider.id))
    } else {
      // Show submenu immediately for instant feedback
      setExpandedProviderIds([...expandedProviderIds, provider.id])
      // Load models in background without blocking UI
      loadProviderModels(provider.id)
    }
  }

  const handleRefreshClick = async (e: React.MouseEvent, providerId: string) => {
    e.stopPropagation()
    // Allow retry on manual refresh
    loadedProvidersRef.current.delete(providerId)
    await refreshProviderModels(providerId)
    await loadProviderModels(providerId)
  }
  
  const handleEditModel = (providerId: string, model: ModelWithConfig) => {
    setEditingModel({ providerId, model })
  }
  
  const handleCloseEditModal = () => {
    setEditingModel(null)
  }

  const handleModelClick = async (providerId: string, newModel: string) => {
    console.log('[ProviderSelector.handleModelClick] providerId:', providerId, 'model:', newModel)
    if (currentSession) {
      // Session-scoped: persist model choice to session
      console.log('[ProviderSelector.handleModelClick] Calling setSessionProvider')
      setSessionProvider(providerId, newModel)
      // Optimistically update UI
      useConfigStore.getState().syncFromSession(providerId, newModel)
      setExpandedProviderIds([])
      setIsOpen(false)
      return
    }

    setLoadingModels('activating')
    try {
      const response = await authFetch(`/api/providers/${providerId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: newModel }),
      })
      if (response.ok) {
        const store = useConfigStore.getState()
        await store.fetchConfig()
        setExpandedProviderIds([])
        setIsOpen(false)
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
        title={isLlmOffline ? 'LLM server is offline. Click to retry.' : (model ?? 'Click to refresh model')}
      >
        {isLlmOffline ? (
          <span className="text-sm text-accent-error animate-pulse">
            LLM offline
          </span>
        ) : (
          <span className="text-sm text-accent-primary">
            {shortModelName}
          </span>
        )}
        <span className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
          ↻
        </span>
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
          <span className="text-sm text-accent-error animate-pulse">
            offline
          </span>
        ) : (
          <span className="text-sm text-accent-primary">
            {shortModelName}
          </span>
        )}
        <svg 
          className={`w-3 h-3 text-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      {/* Unified Provider + Model Dropdown */}
      {isOpen && (
        <div className="absolute bottom-full right-0 mb-1 w-72 bg-bg-secondary border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="py-1">
            {providers.map(provider => (
              <div key={provider.id}>
                <div className={`px-3 py-2 flex items-center justify-between ${
                  provider.id === activeProviderId ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary'
                } ${activating ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}>
                  <div 
                    onClick={() => !activating && handleProviderClick(provider)}
                    className="flex flex-col min-w-0 flex-1 cursor-pointer"
                  >
                    <span className={`text-sm font-medium truncate ${
                      provider.id === activeProviderId ? 'text-accent-primary' : 'text-text-primary'
                    }`}>
                      {provider.name}
                    </span>
                    <span className="text-xs text-text-muted truncate">
                      {provider.backend !== 'auto' && getBackendDisplayName(provider.backend)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {provider.id === activeProviderId ? (
                      <span className="text-accent-success" title="Active">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
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
                      <svg 
                        className={`w-4 h-4 ${loadingModels === provider.id ? 'animate-spin' : ''} ${
                          provider.id === activeProviderId ? 'text-accent-primary' : 'text-text-muted'
                        }`}
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
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
                      <svg 
                        className={`w-4 h-4 transition-transform ${expandedProviderIds.includes(provider.id) ? 'rotate-180' : ''} ${
                          provider.id === activeProviderId ? 'text-accent-primary' : 'text-text-muted'
                        }`}
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                </div>
                
                {/* Model submenu - shown for expanded provider */}
                {expandedProviderIds.includes(provider.id) && (
                  <div className="bg-bg-primary border-t border-border">
                    {loadingModels === provider.id ? (
                      <div className="px-4 py-2 text-xs text-text-muted">
                        Loading models...
                      </div>
                    ) : provider.models?.length ? (
                      provider.models.map(modelConfig => (
                        <button
                          key={modelConfig.id}
                          type="button"
                          onClick={() => handleModelClick(provider.id, modelConfig.id)}
                          disabled={loadingModels === 'activating'}
                          className={`w-full px-4 py-1.5 text-left hover:bg-bg-tertiary transition-colors text-sm flex items-center justify-between group ${
                            loadingModels === 'activating' ? 'opacity-50 cursor-wait' : ''
                          } ${
                            model === modelConfig.id ? 'text-accent-primary' : 'text-text-secondary'
                          }`}
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
                              <svg className="w-3 h-3 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                          </div>
                          {model === modelConfig.id && (
                            <span className="text-accent-success flex-shrink-0 ml-1">
                              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            </span>
                          )}
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-2 text-xs text-text-muted">
                        No models available
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="border-t border-border px-3 py-2">
            <button
              onClick={() => navigate('/onboarding')}
              className="text-xs text-accent-primary hover:underline"
            >
              Open onboarding to add providers
            </button>
          </div>
        </div>
      )}
      {editingModel && (
        <ModelPropertiesModal
          isOpen={true}
          onClose={handleCloseEditModal}
          providerId={editingModel!.providerId}
          model={editingModel!.model}
        />
      )}
    </div>
  )
}
