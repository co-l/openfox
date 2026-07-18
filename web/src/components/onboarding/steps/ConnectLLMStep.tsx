import { useState, useEffect } from 'react'
import { authFetch } from '../../../lib/api'
import { PlusLgIcon, TrashIcon } from '../../shared/icons'
import { ProviderModal, providerFormPayload, type ProviderFormData } from '../../shared/ProviderModal'
import { getBackendDisplayName, type ProviderInfo } from '../types'

interface ConnectLLMStepProps {
  onNext: (data: { providers: ProviderInfo[] }) => void
}

export function ConnectLLMStep({ onNext }: ConnectLLMStepProps) {
  const [existingProviders, setExistingProviders] = useState<ProviderInfo[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ProviderInfo | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)

  useEffect(() => {
    fetchExistingProviders()
  }, [])

  async function fetchExistingProviders() {
    try {
      const response = await authFetch('/api/providers')
      if (response.ok) {
        const data = (await response.json()) as {
          providers: Array<{
            id: string
            name: string
            url: string
            backend: string
            apiKey?: string
            isLocal?: boolean
            thinkingField?: string
            models?: Array<{
              id: string
              contextWindow: number
              supportsVision?: boolean
              thinkingEnabled?: boolean
              thinkingLevel?: string
              nonThinkingEnabled?: boolean
            }>
          }>
        }
        const mapped: ProviderInfo[] = data.providers.map((p) => ({
          id: p.id,
          name: p.name,
          url: p.url,
          backend: p.backend as ProviderInfo['backend'],
          model: null,
          apiKey: p.apiKey,
          isLocal: p.isLocal,
          thinkingField: p.thinkingField,
          models: p.models,
        }))
        setExistingProviders(mapped)
        setProviders(mapped)
      }
    } catch {
      /* empty */
    }
  }

  async function handleSave(formData: ProviderFormData) {
    const isTemporary = formData.id.startsWith('temp-')
    const wasListed = providers.some((provider) => provider.id === formData.id)
    const shouldAdvance = providers.length === 0 && editingProvider === null
    const body = providerFormPayload(formData)

    try {
      let saved: ProviderInfo

      if (isTemporary) {
        const response = await authFetch('/api/providers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!response.ok) throw new Error('Failed to create provider')
        const data = (await response.json()) as { provider: { id: string } }
        saved = { ...formData, id: data.provider.id, model: null }
      } else {
        const response = await authFetch(`/api/providers/${formData.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!response.ok) throw new Error('Failed to update provider')
        saved = { ...formData, model: null }
      }

      const mergeSaved = (current: ProviderInfo[]) =>
        current.some((provider) => provider.id === saved.id)
          ? current.map((provider) => (provider.id === saved.id ? saved : provider))
          : [...current, saved]

      setProviders(mergeSaved)
      setExistingProviders(mergeSaved)

      // An authenticated provider can create a real provider ID before the final save.
      // It was not previously present in local state, so proceed with the saved provider directly.
      if (shouldAdvance && !wasListed) {
        onNext({ providers: [saved] })
      }
    } catch {
      // A temporary provider can remain visible locally and be retried later.
      if (isTemporary) {
        const fallback: ProviderInfo = { ...formData, model: null }
        setProviders((current) => [...current, fallback])
      }
    }
  }

  function openAddModal() {
    setEditingProvider(null)
    setShowModal(true)
  }

  function openEditModal(provider: ProviderInfo) {
    setEditingProvider(provider)
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditingProvider(null)
  }

  function removeProvider(id: string) {
    setRemoving(id)
    const isExisting = existingProviders.some((p) => p.id === id)
    if (isExisting) {
      authFetch(`/api/providers/${id}`, { method: 'DELETE' })
        .then(() => {
          setProviders(providers.filter((p) => p.id !== id))
          setExistingProviders(existingProviders.filter((p) => p.id !== id))
          setRemoving(null)
        })
        .catch(() => setRemoving(null))
    } else {
      setProviders(providers.filter((p) => p.id !== id))
      setRemoving(null)
    }
  }

  function handleSubmit() {
    const validProviders = providers.filter((p) => !p.id.startsWith('temp-'))
    onNext({ providers: validProviders })
  }

  const hasProviders = providers.length > 0

  return (
    <div className="max-w-xl mx-auto">
      <h2 className="text-2xl font-bold text-text-primary mb-2">LLM Providers</h2>
      <p className="text-text-secondary mb-8">Manage your LLM server connections</p>

      <div className="space-y-4">
        {providers.length > 0 ? (
          <div className="space-y-2">
            {providers.map((provider) => (
              <div
                key={provider.id}
                className="flex items-center justify-between bg-bg-secondary rounded-lg p-4 border border-border"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-accent-primary/25 text-accent-primary rounded text-xs font-medium">
                      {getBackendDisplayName(provider.backend)}
                    </span>
                    <span className="text-text-primary font-medium">{provider.name}</span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded-full ${provider.isLocal ? 'text-accent-success bg-accent-success/10' : 'text-accent-warning bg-accent-warning/10'}`}
                    >
                      {provider.isLocal ? 'local' : 'api'}
                    </span>
                  </div>
                  <p className="text-text-muted text-sm mt-1 truncate">{provider.url}</p>
                  {provider.model && <p className="text-text-secondary text-xs mt-0.5">Model: {provider.model}</p>}
                </div>
                <div className="flex items-center gap-1">
                  {confirmingDelete === provider.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => removeProvider(provider.id)}
                        disabled={removing === provider.id}
                        className="px-2 py-1 text-xs text-red-500 hover:text-red-400 bg-red-500/10 rounded transition-colors disabled:opacity-50"
                      >
                        {removing === provider.id ? 'Deleting...' : 'Confirm'}
                      </button>
                      <button
                        onClick={() => setConfirmingDelete(null)}
                        className="px-2 py-1 text-xs text-text-muted hover:text-text-secondary transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => openEditModal(provider)}
                        className="px-2 py-1 text-xs text-text-muted hover:text-text-secondary border border-border rounded transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setConfirmingDelete(provider.id)}
                        className="p-2 text-text-muted hover:text-red-500 transition-colors"
                        title="Remove provider"
                      >
                        <TrashIcon />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-bg-secondary rounded-lg p-8 text-center border border-border">
            <p className="text-text-muted">No providers configured yet</p>
          </div>
        )}

        <button
          onClick={openAddModal}
          data-testid="onboarding-add-provider-button"
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-bg-secondary border border-dashed border-border rounded-lg text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors"
        >
          <PlusLgIcon className="w-4 h-4" />
          Add Provider
        </button>

        <button
          onClick={handleSubmit}
          disabled={!hasProviders}
          data-testid="onboarding-continue-button"
          className="w-full mt-6 px-6 py-3 bg-accent-primary text-text-primary rounded-lg font-medium hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Continue
        </button>
      </div>

      <ProviderModal
        isOpen={showModal}
        onClose={closeModal}
        onSave={handleSave}
        initialStep={1}
        editProvider={editingProvider ?? undefined}
      />
    </div>
  )
}
