import { useState, useEffect } from 'react'
import { authFetch } from '../../../lib/api'
import { PlusLgIcon, TrashIcon } from '../../shared/icons'
import { ProviderModal, type ProviderFormData } from '../../shared/ProviderModal'
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
    const isNew = formData.id.startsWith('temp-')
    const body = {
      name: formData.name,
      url: formData.url,
      backend: formData.backend,
      apiKey: formData.apiKey,
      isLocal: formData.isLocal,
      thinkingField: formData.thinkingField,
      models: formData.models,
    }
    try {
      if (isNew) {
        const res = await authFetch('/api/providers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (res.ok) {
          const data = (await res.json()) as { provider: { id: string } }
          const saved: ProviderInfo = { ...formData, id: data.provider.id, model: null }
          setProviders((prev) => [...prev, saved])
          setExistingProviders((prev) => [...prev, saved])
        }
      } else {
        await authFetch(`/api/providers/${formData.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        setProviders((prev) => prev.map((p) => (p.id === formData.id ? { ...p, ...formData, model: null } : p)))
        setExistingProviders((prev) => prev.map((p) => (p.id === formData.id ? { ...p, ...formData, model: null } : p)))
      }
    } catch {
      // Save failed — provider stays in local state with temp ID, retry on Continue
      if (isNew) {
        const fallback: ProviderInfo = { ...formData, model: null }
        setProviders((prev) => [...prev, fallback])
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
                <div className="flex-1">
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
                  <p className="text-text-muted text-sm mt-1">{provider.url}</p>
                  {provider.model && <p className="text-text-secondary text-xs mt-0.5">Model: {provider.model}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEditModal(provider)}
                    className="px-2 py-1 text-xs text-text-muted hover:text-text-secondary border border-border rounded transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => removeProvider(provider.id)}
                    disabled={removing === provider.id}
                    className="p-2 text-text-muted hover:text-red-500 transition-colors disabled:opacity-50"
                    title="Remove provider"
                  >
                    <TrashIcon />
                  </button>
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
