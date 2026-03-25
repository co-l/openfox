import { useState, useRef, useEffect } from 'react'
import { useConfigStore, getBackendDisplayName, type Provider } from '../../stores/config'
import { useSessionStore } from '../../stores/session'

export function ProviderSelector() {
  const currentSession = useSessionStore(state => state.currentSession)
  const setSessionProvider = useSessionStore(state => state.setSessionProvider)
  const [isOpen, setIsOpen] = useState(false)
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null)
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({})
  const [loadingModels, setLoadingModels] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  
  const providers = useConfigStore(state => state.providers)
  const activeProviderId = useConfigStore(state => state.activeProviderId)
  const model = useConfigStore(state => state.model)
  const backend = useConfigStore(state => state.backend)
  const llmStatus = useConfigStore(state => state.llmStatus)
  const activating = useConfigStore(state => state.activating)
  const activateProvider = useConfigStore(state => state.activateProvider)
  const refreshModel = useConfigStore(state => state.refreshModel)
  
  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setExpandedProviderId(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const activeProvider = providers.find(p => p.id === activeProviderId)
  const isLlmOffline = llmStatus === 'disconnected'
  
  // Short model name for display
  const shortModelName = model
    ? model.split('/').pop()?.replace(/-/g, ' ') ?? model
    : 'detecting...'
  
  const backendName = getBackendDisplayName(backend)

  const loadProviderModels = async (providerId: string) => {
    if (providerModels[providerId]) return providerModels[providerId]
    
    setLoadingModels(providerId)
    try {
      const response = await fetch(`/api/providers/${providerId}/models`)
      if (response.ok) {
        const data = await response.json() as { models: string[] }
        setProviderModels(prev => ({ ...prev, [providerId]: data.models }))
        return data.models
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingModels(null)
    }
    return null
  }

  const handleProviderClick = async (provider: Provider) => {
    if (provider.id === activeProviderId) {
      // Toggle model expansion for active provider
      if (expandedProviderId === provider.id) {
        setExpandedProviderId(null)
      } else {
        // Show submenu immediately for instant feedback
        setExpandedProviderId(provider.id)
        // Load models in background without blocking UI
        loadProviderModels(provider.id)
      }
      return
    }
    
    // Switch to different provider
    if (currentSession) {
      // Session-scoped: persist provider choice to session
      setSessionProvider(provider.id, provider.model !== 'auto' ? provider.model : undefined)
      // Optimistically update UI
      useConfigStore.getState().syncFromSession(provider.id, provider.model)
      setIsOpen(false)
      setExpandedProviderId(null)
    } else {
      const success = await activateProvider(provider.id)
      if (success) {
        setIsOpen(false)
        setExpandedProviderId(null)
      }
    }
  }

  const handleChevronClick = (provider: Provider) => {
    // Toggle model expansion for any provider
    if (expandedProviderId === provider.id) {
      setExpandedProviderId(null)
    } else {
      // Show submenu immediately for instant feedback
      setExpandedProviderId(provider.id)
      // Load models in background without blocking UI
      loadProviderModels(provider.id)
    }
  }

  const handleModelClick = async (providerId: string, newModel: string) => {
    if (currentSession) {
      // Session-scoped: persist model choice to session
      setSessionProvider(providerId, newModel)
      // Optimistically update UI
      useConfigStore.getState().syncFromSession(providerId, newModel)
      setExpandedProviderId(null)
      setIsOpen(false)
      return
    }

    setLoadingModels('activating')
    try {
      const response = await fetch(`/api/providers/${providerId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: newModel }),
      })
      if (response.ok) {
        const store = useConfigStore.getState()
        await store.fetchConfig()
        setExpandedProviderId(null)
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
                      {provider.model === 'auto' ? 'Auto-detect' : provider.model.split('/').pop()?.replace(/-/g, ' ')}
                      {provider.backend !== 'auto' && ` (${getBackendDisplayName(provider.backend)})`}
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
                        handleChevronClick(provider)
                      }}
                      className="p-0.5 hover:bg-bg-tertiary rounded transition-colors"
                      title="Show models"
                    >
                      <svg 
                        className={`w-4 h-4 transition-transform ${expandedProviderId === provider.id ? 'rotate-180' : ''} ${
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
                {expandedProviderId === provider.id && (
                  <div className="bg-bg-primary border-t border-border">
                    {loadingModels === provider.id ? (
                      <div className="px-4 py-2 text-xs text-text-muted">
                        Loading models...
                      </div>
                    ) : providerModels[provider.id]?.length ? (
                      providerModels[provider.id]!.map(modelName => (
                        <button
                          key={modelName}
                          type="button"
                          onClick={() => handleModelClick(provider.id, modelName)}
                          disabled={loadingModels === 'activating'}
                          className={`w-full px-4 py-1.5 text-left hover:bg-bg-tertiary transition-colors text-sm flex items-center justify-between ${
                            loadingModels === 'activating' ? 'opacity-50 cursor-wait' : ''
                          } ${
                            model === modelName ? 'text-accent-primary' : 'text-text-secondary'
                          }`}
                        >
                          <span className="truncate">
                            {modelName.split('/').pop()?.replace(/-/g, ' ') ?? modelName}
                          </span>
                          {model === modelName && (
                            <span className="text-accent-success flex-shrink-0">
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
            <p className="text-xs text-text-muted">
              Use <code className="bg-bg-tertiary px-1 rounded">openfox provider add</code> to add more providers
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
