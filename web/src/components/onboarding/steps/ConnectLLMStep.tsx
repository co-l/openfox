import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { useT } from '../../../hooks/useT'
import { authFetch } from '../../../lib/api'
import { useResource } from '../../../hooks/useResource'
import { providersResource } from '../../../lib/resources'
import { PlusLgIcon, TrashIcon, ChevronUpIcon, ChevronDownIcon, GripVerticalIcon } from '../../shared/icons'
import { ProviderModal, providerFormPayload, type ProviderFormData } from '../../shared/ProviderModal'
import { getBackendDisplayName, type ProviderInfo } from '../types'

export interface ConnectLLMStepHandle {
  addProvider: () => void
  submit: () => void
}

interface ConnectLLMStepProps {
  onNext: (data: { providers: ProviderInfo[] }) => void
  /** Embed the step in a hosting surface (e.g. a manage-providers modal) instead of a wizard: no auto-advance and no onboarding chrome. */
  embedded?: boolean
}

export const ConnectLLMStep = forwardRef<ConnectLLMStepHandle, ConnectLLMStepProps>(function ConnectLLMStep(
  { onNext, embedded = false },
  ref,
) {
  const t = useT()
  const [existingProviders, setExistingProviders] = useState<ProviderInfo[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ProviderInfo | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [reorderError, setReorderError] = useState(false)
  const orderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { data: providersData } = useResource(providersResource)

  useEffect(() => {
    return () => {
      if (orderTimeoutRef.current) clearTimeout(orderTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (!providersData) return
    const mapped: ProviderInfo[] = providersData.providers.map((p) => ({
      id: p.id,
      name: p.name,
      url: p.url,
      backend: p.backend as ProviderInfo['backend'],
      model: null,
      apiKey: p.apiKey,
      isLocal: p.isLocal,
      thinkingField: p.thinkingField,
      sendReasoningInMessages: p.sendReasoningInMessages,
      models: p.models,
    }))
    setExistingProviders(mapped)
    setProviders(mapped)
  }, [providersData])

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
      if (!embedded && shouldAdvance && !wasListed) {
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

  // Apply a new order optimistically and persist it. Rapid reorders are
  // debounced into a single request so the last action always wins; on failure,
  // surface feedback and restore the authoritative order from the server.
  function persistOrder(ordered: ProviderInfo[]) {
    setProviders(ordered)
    if (orderTimeoutRef.current) clearTimeout(orderTimeoutRef.current)
    orderTimeoutRef.current = setTimeout(() => {
      orderTimeoutRef.current = null
      authFetch('/api/providers/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerIds: ordered.map((p) => p.id) }),
      })
        .then((response) => {
          if (response.ok) {
            setReorderError(false)
          } else {
            setReorderError(true)
            void restoreProviderOrder()
          }
        })
        .catch(() => {
          setReorderError(true)
          void restoreProviderOrder()
        })
    }, 300)
  }

  async function restoreProviderOrder() {
    try {
      const data = await providersResource.refresh()
      if (!data) return
      const serverIds = data.providers.map((p) => p.id)
      setProviders((current) => {
        const serverIdSet = new Set(serverIds)
        const sameSet = current.length === serverIds.length && current.every((p) => serverIdSet.has(p.id))
        if (!sameSet) return current
        return serverIds.map((id) => current.find((p) => p.id === id)).filter((p): p is ProviderInfo => p !== undefined)
      })
    } catch {
      // Keep the optimistic local order; a later reorder will retry persistence.
    }
  }

  function moveProvider(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= providers.length) return
    const next = [...providers]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved!)
    persistOrder(next)
  }

  function handleDragStart(providerId: string) {
    setDraggingId(providerId)
  }

  function handleDragOver(providerId: string) {
    setDragOverId(providerId)
  }

  function handleDrop(targetId: string) {
    if (!draggingId || draggingId === targetId) return
    const from = providers.findIndex((p) => p.id === draggingId)
    const to = providers.findIndex((p) => p.id === targetId)
    if (from === -1 || to === -1) return
    const next = [...providers]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved!)
    persistOrder(next)
  }

  function handleDragEnd() {
    setDraggingId(null)
    setDragOverId(null)
  }

  useImperativeHandle(
    ref,
    () => ({
      addProvider: openAddModal,
      submit: handleSubmit,
    }),
    [handleSubmit],
  )

  const hasProviders = providers.length > 0

  return (
    <div className="max-w-xl mx-auto">
      {!embedded && (
        <>
          <h2 className="text-2xl font-bold text-text-primary mb-2">
            {t({ en: 'LLM Providers', fr: 'Fournisseurs LLM' })}
          </h2>
          <p className="text-text-secondary mb-8">
            {t({ en: 'Manage your LLM server connections', fr: 'Gérez vos connexions aux serveurs LLM' })}
          </p>
        </>
      )}

      <div className="space-y-4">
        {providers.length > 0 ? (
          <div className="space-y-2">
            {providers.map((provider, index) => (
              <div
                key={provider.id}
                data-testid={`provider-row-${provider.id}`}
                onDragOver={(e) => {
                  if (!draggingId) return
                  e.preventDefault()
                  handleDragOver(provider.id)
                }}
                onDrop={(e) => {
                  if (!draggingId) return
                  e.preventDefault()
                  handleDrop(provider.id)
                }}
                className={`flex items-center justify-between bg-bg-secondary rounded-lg p-4 border ${
                  dragOverId === provider.id ? 'border-accent-primary' : 'border-border'
                }`}
              >
                {embedded && (
                  <button
                    type="button"
                    draggable
                    onDragStart={() => handleDragStart(provider.id)}
                    onDragEnd={handleDragEnd}
                    className="p-1.5 mr-1 text-text-muted hover:text-text-secondary cursor-grab active:cursor-grabbing transition-colors"
                    title={t({ en: 'Drag to reorder', fr: 'Glisser pour réordonner' })}
                    aria-label={t({ en: 'Drag to reorder', fr: 'Glisser pour réordonner' })}
                  >
                    <GripVerticalIcon className="w-4 h-4" />
                  </button>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-accent-primary/25 text-accent-primary rounded text-xs font-medium">
                      {getBackendDisplayName(provider.backend)}
                    </span>
                    <span className="text-text-primary font-medium">{provider.name}</span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded-full ${provider.isLocal ? 'text-accent-success bg-accent-success/10' : 'text-accent-warning bg-accent-warning/10'}`}
                    >
                      {provider.isLocal ? t({ en: 'local', fr: 'local' }) : t({ en: 'api', fr: 'api' })}
                    </span>
                  </div>
                  <p className="text-text-muted text-sm mt-1 truncate">{provider.url}</p>
                  {provider.model && (
                    <p className="text-text-secondary text-xs mt-0.5">
                      {t({ en: 'Model:', fr: 'Modèle :' })} {provider.model}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {confirmingDelete === provider.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => removeProvider(provider.id)}
                        disabled={removing === provider.id}
                        className="px-2 py-1 text-xs text-red-500 hover:text-red-400 bg-red-500/10 rounded transition-colors disabled:opacity-50"
                      >
                        {removing === provider.id
                          ? t({ en: 'Deleting...', fr: 'Suppression…' })
                          : t({ en: 'Confirm', fr: 'Confirmer' })}
                      </button>
                      <button
                        onClick={() => setConfirmingDelete(null)}
                        className="px-2 py-1 text-xs text-text-muted hover:text-text-secondary transition-colors"
                      >
                        {t({ en: 'Cancel', fr: 'Annuler' })}
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => openEditModal(provider)}
                        className="px-2 py-1 text-xs text-text-muted hover:text-text-secondary border border-border rounded transition-colors"
                      >
                        {t({ en: 'Edit', fr: 'Modifier' })}
                      </button>
                      <button
                        onClick={() => setConfirmingDelete(provider.id)}
                        className="p-2 text-text-muted hover:text-red-500 transition-colors"
                        title={t({ en: 'Remove provider', fr: 'Supprimer le fournisseur' })}
                      >
                        <TrashIcon />
                      </button>
                    </>
                  )}
                </div>
                {embedded && (
                  <div className="flex flex-col ml-1">
                    <button
                      type="button"
                      onClick={() => moveProvider(index, -1)}
                      disabled={index === 0}
                      className="p-0.5 text-text-muted hover:text-text-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title={t({ en: 'Move up', fr: 'Monter' })}
                      aria-label={t({ en: 'Move up', fr: 'Monter' })}
                    >
                      <ChevronUpIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveProvider(index, 1)}
                      disabled={index === providers.length - 1}
                      className="p-0.5 text-text-muted hover:text-text-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title={t({ en: 'Move down', fr: 'Descendre' })}
                      aria-label={t({ en: 'Move down', fr: 'Descendre' })}
                    >
                      <ChevronDownIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-bg-secondary rounded-lg p-8 text-center border border-border">
            <p className="text-text-muted">
              {t({ en: 'No providers configured yet', fr: 'Aucun fournisseur configuré pour le moment' })}
            </p>
          </div>
        )}

        {embedded && reorderError && (
          <p className="text-xs text-red-500 mt-1">
            {t({
              en: "Couldn't save the new provider order. Showing the last saved order.",
              fr: 'Impossible d’enregistrer le nouvel ordre des fournisseurs. Affichage du dernier ordre enregistré.',
            })}
          </p>
        )}

        {!embedded && (
          <>
            <button
              onClick={openAddModal}
              data-testid="onboarding-add-provider-button"
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-bg-secondary border border-dashed border-border rounded-lg text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors"
            >
              <PlusLgIcon className="w-4 h-4" />
              {t({ en: 'Add Provider', fr: 'Ajouter un fournisseur' })}
            </button>

            <button
              onClick={handleSubmit}
              disabled={!hasProviders}
              data-testid="onboarding-continue-button"
              className="w-full mt-6 px-6 py-3 bg-accent-primary text-text-primary rounded-lg font-medium hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {embedded ? t({ en: 'Done', fr: 'Terminé' }) : t({ en: 'Continue', fr: 'Continuer' })}
            </button>
          </>
        )}
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
})
