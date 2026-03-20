import { useState, useRef, useEffect } from 'react'
import { useConfigStore, getBackendDisplayName, type Provider } from '../../stores/config'

export function ProviderSelector() {
  const [isOpen, setIsOpen] = useState(false)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({})
  const [loadingModels, setLoadingModels] = useState(false)
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
        setShowModelMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])
  
  const activeProvider = providers.find(p => p.id === activeProviderId)
  const isLlmOffline = llmStatus === 'disconnected'
  const hasMultipleProviders = providers.length > 1
  
  // Short model name for display
  const shortModelName = model
    ? model.split('/').pop()?.replace(/-/g, ' ') ?? model
    : 'detecting...'
  
  const backendName = getBackendDisplayName(backend)
  
  const handleProviderClick = async (provider: Provider) => {
    if (provider.id === activeProviderId) {
      // Close provider dropdown and show model selection menu
      setIsOpen(false)
      if (providerModels[provider.id]) {
        setShowModelMenu(true)
      } else {
        setLoadingModels(true)
        try {
          const response = await fetch(`/api/providers/${provider.id}/models`)
          if (response.ok) {
            const data = await response.json() as { models: string[] }
            setProviderModels(prev => ({ ...prev, [provider.id]: data.models }))
            setShowModelMenu(true)
          }
        } catch {
          // Silently fail
        } finally {
          setLoadingModels(false)
        }
      }
      return
    }
    
    const success = await activateProvider(provider.id)
    if (success) {
      setIsOpen(false)
      setShowModelMenu(false)
    }
  }

  const handleModelClick = async (providerId: string, newModel: string) => {
    setLoadingModels(true)
    try {
      const response = await fetch(`/api/providers/${providerId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: newModel }),
      })
      if (response.ok) {
        // Refresh the config to sync state from server
        const store = useConfigStore.getState()
        await store.fetchConfig()
        setShowModelMenu(false)
        setIsOpen(false)
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingModels(false)
    }
  }
  
  // If no providers configured, show simple model display
  if (providers.length === 0) {
    return (
      <button
        onClick={() => refreshModel()}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-bg-tertiary transition-colors group"
        title={isLlmOffline ? 'LLM server is offline. Click to retry.' : (model ?? 'Click to refresh model')}
      >
        <span className="text-sm text-text-muted">Model:</span>
        {isLlmOffline ? (
          <span className="text-sm text-accent-error animate-pulse">
            LLM offline
          </span>
        ) : (
          <span className="text-sm text-accent-primary">
            {shortModelName}
            {backendName && (
              <span className="text-text-muted ml-1">({backendName})</span>
            )}
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
        onClick={() => hasMultipleProviders ? setIsOpen(!isOpen) : refreshModel()}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-bg-tertiary transition-colors group"
        title={hasMultipleProviders 
          ? `${activeProvider?.name ?? 'Provider'} - Click to switch providers` 
          : (isLlmOffline ? 'LLM server is offline. Click to retry.' : (model ?? 'Click to refresh model'))}
      >
        {isLlmOffline ? (
          <>
            <span className="text-sm text-text-muted">Provider:</span>
            <span className="text-sm text-accent-error animate-pulse">
              offline
            </span>
          </>
        ) : (
          <>
            <span className="text-sm text-text-muted">
              {activeProvider?.name ?? 'Provider'}:
            </span>
            <span className="text-sm text-accent-primary">
              {shortModelName}
              {backendName && (
                <span className="text-text-muted ml-1">({backendName})</span>
              )}
            </span>
          </>
        )}
        {hasMultipleProviders ? (
          <svg 
            className={`w-3 h-3 text-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        ) : (
          <span className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
            ↻
          </span>
        )}
      </button>
      
      {/* Provider Dropdown */}
      {isOpen && hasMultipleProviders && (
        <div className="absolute top-full right-0 mt-1 w-64 bg-bg-secondary border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="py-1">
            {providers.map(provider => (
              <button
                key={provider.id}
                onClick={() => handleProviderClick(provider)}
                disabled={activating}
                className={`w-full px-3 py-2 text-left hover:bg-bg-tertiary transition-colors flex items-center justify-between ${
                  provider.id === activeProviderId ? 'bg-bg-tertiary' : ''
                } ${activating ? 'opacity-50 cursor-wait' : ''}`}
              >
                <div className="flex flex-col min-w-0">
                  <span className={`text-sm font-medium truncate ${
                    provider.id === activeProviderId ? 'text-accent-primary' : 'text-text-primary'
                  }`}>
                    {provider.name}
                  </span>
                  <span className="text-xs text-text-muted truncate">
                    {provider.model === 'auto' ? 'Auto-detect' : provider.model}
                    {provider.backend !== 'auto' && ` (${getBackendDisplayName(provider.backend)})`}
                  </span>
                </div>
                {provider.id === activeProviderId && (
                  <span className="text-accent-success ml-2 flex-shrink-0">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="border-t border-border px-3 py-2">
            <p className="text-xs text-text-muted">
              Use <code className="bg-bg-tertiary px-1 rounded">openfox provider add</code> to add more providers
            </p>
          </div>
        </div>
      )}

      {/* Model Selection Dropdown */}
      {showModelMenu && activeProviderId && (
        <div className="absolute top-full right-0 mt-1 w-56 bg-bg-secondary border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-xs text-text-muted font-medium">Select model for {activeProvider?.name}</p>
          </div>
          <div className="py-1 max-h-64 overflow-y-auto">
            {loadingModels ? (
              <div className="px-3 py-2 text-xs text-text-muted">Loading models...</div>
            ) : providerModels[activeProviderId]?.length && providerModels[activeProviderId].length > 0 ? (
              providerModels[activeProviderId]!.map(modelName => (
                <button
                  key={modelName}
                  onClick={() => handleModelClick(activeProviderId, modelName)}
                  className={`w-full px-3 py-2 text-left hover:bg-bg-tertiary transition-colors text-sm ${
                    model === modelName ? 'text-accent-primary font-medium' : 'text-text-primary'
                  }`}
                >
                  {modelName.split('/').pop()?.replace(/-/g, ' ') ?? modelName}
                  {model === modelName && (
                    <span className="ml-2 text-accent-success">✓</span>
                  )}
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-text-muted">No models available</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
