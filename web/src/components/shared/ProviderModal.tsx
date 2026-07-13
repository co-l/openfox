import { useState, useEffect, useRef } from 'react'
import { authFetch } from '../../lib/api'
import type { Backend } from '../../stores/config'
import type { ModelConfig as SharedModelConfig } from '@shared/types.js'
import { ChevronDownIcon } from './icons'
import { QueryParamsInput } from './QueryParamsInput'

const COMMON_PORTS = [8080, 11434, 8000]

interface ModelInfo {
  id: string
  contextWindow: number
}

interface ModelConfig {
  contextWindow: number
  supportsVision?: boolean
  thinkingEnabled?: boolean
  thinkingLevel?: string
  nonThinkingEnabled?: boolean
  thinkingExtraKwargs?: string
  nonThinkingExtraKwargs?: string
  thinkingQueryParams?: string
  nonThinkingQueryParams?: string
  temperature?: number
  topP?: number
  topK?: number
  maxTokens?: number
  defaultTemperature?: number
  defaultTopP?: number
  defaultTopK?: number
  defaultMaxTokens?: number
}

export interface ProviderFormData {
  id: string
  name: string
  url: string
  backend: Backend
  apiKey?: string
  isLocal?: boolean
  thinkingField?: string
  models: Array<Omit<SharedModelConfig, 'source'>>
}

interface ProviderModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (provider: ProviderFormData) => void
  initialStep?: 1 | 2
  editProvider?: {
    id: string
    name: string
    url: string
    backend: Backend
    apiKey?: string
    isLocal?: boolean
    thinkingField?: string
    models?: Array<Omit<SharedModelConfig, 'source'>>
  }
  editModelId?: string
}

function ModelConfigPanel({
  model,
  modelConfigs,
  autoConfigState,
  testResults,
  onUpdateConfig,
  onRunAutoConfig,
  onTestParams,
  onShowRaw,
}: {
  model: ModelInfo
  modelConfigs: Record<string, ModelConfig>
  autoConfigState: { loading: boolean; progress: Record<string, 'pending' | 'probing' | 'done' | 'error'> }
  testResults: Record<string, { loading: boolean; result?: string; error?: string }>
  onUpdateConfig: (id: string, partial: Partial<ModelConfig>) => void
  onRunAutoConfig: (id: string) => void
  onTestParams: (id: string, mode: 'thinking' | 'non-thinking') => void
  onShowRaw: (data: string) => void
}) {
  return (
    <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => onRunAutoConfig(model.id)}
          disabled={autoConfigState.progress[model.id] === 'probing'}
          className="px-4 py-2 bg-accent-primary text-text-primary rounded-lg text-sm font-medium hover:bg-accent-primary/90 disabled:opacity-50 transition-colors"
        >
          {autoConfigState.progress[model.id] === 'probing' ? 'Probing...' : 'Auto-config'}
        </button>
        {autoConfigState.progress[model.id] === 'done' && (
          <span className="text-sm text-accent-success font-medium">Configured ✓</span>
        )}
        {autoConfigState.progress[model.id] === 'error' && (
          <span className="text-sm text-red-500 font-medium">Failed ✗</span>
        )}
      </div>

      <div className="flex gap-3 items-end">
        <div>
          <label className="text-xs text-text-secondary block mb-1">Context window (tokens)</label>
          <input
            type="number"
            value={modelConfigs[model.id]?.contextWindow ?? model.contextWindow}
            onChange={(e) =>
              onUpdateConfig(model.id, {
                contextWindow: parseInt(e.target.value) || model.contextWindow,
              })
            }
            className="w-32 px-2 py-1 bg-bg-tertiary border border-border rounded text-xs text-text-primary"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-text-secondary pb-1">
          <input
            type="checkbox"
            checked={modelConfigs[model.id]?.supportsVision ?? false}
            onChange={(e) => onUpdateConfig(model.id, { supportsVision: e.target.checked })}
            className="accent-accent-primary"
          />{' '}
          Supports vision
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onTestParams(model.id, 'thinking')}
            disabled={testResults[model.id + '-thinking']?.loading}
            className="px-3 py-1.5 bg-bg-tertiary border border-border rounded text-xs font-medium hover:bg-bg-secondary disabled:opacity-50 transition-colors"
          >
            {testResults[model.id + '-thinking']?.loading ? 'Testing...' : 'Test thinking'}
          </button>
          {testResults[model.id + '-thinking']?.result && <span className="text-xs text-accent-success">OK</span>}
          {testResults[model.id + '-thinking']?.error && (
            <span className="text-xs text-red-500" title={testResults[model.id + '-thinking']?.error}>
              Fail
            </span>
          )}
          {testResults[model.id + '-thinking']?.result && (
            <button
              onClick={() => onShowRaw(testResults[model.id + '-thinking']!.result!)}
              className="text-xs text-accent-primary hover:underline"
            >
              raw
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onTestParams(model.id, 'non-thinking')}
            disabled={testResults[model.id + '-non-thinking']?.loading}
            className="px-3 py-1.5 bg-bg-tertiary border border-border rounded text-xs font-medium hover:bg-bg-secondary disabled:opacity-50 transition-colors"
          >
            {testResults[model.id + '-non-thinking']?.loading ? 'Testing...' : 'Test non-thinking'}
          </button>
          {testResults[model.id + '-non-thinking']?.result && <span className="text-xs text-accent-success">OK</span>}
          {testResults[model.id + '-non-thinking']?.error && (
            <span className="text-xs text-red-500" title={testResults[model.id + '-non-thinking']?.error}>
              Fail
            </span>
          )}
          {testResults[model.id + '-non-thinking']?.result && (
            <button
              onClick={() => onShowRaw(testResults[model.id + '-non-thinking']!.result!)}
              className="text-xs text-accent-primary hover:underline"
            >
              raw
            </button>
          )}
        </div>
      </div>

      <details className="group">
        <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary list-none flex items-center gap-1 select-none">
          <ChevronDownIcon className="w-3 h-3 transition-transform group-open:rotate-180" />
          Advanced: thinking &amp; non-thinking params
        </summary>
        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={modelConfigs[model.id]?.thinkingEnabled ?? false}
              onChange={(e) => onUpdateConfig(model.id, { thinkingEnabled: e.target.checked })}
              className="w-4 h-4 rounded border-border bg-bg-tertiary accent-accent-primary"
            />
            <span className="text-xs font-medium text-text-primary">Thinking</span>
          </label>
          {modelConfigs[model.id]?.thinkingEnabled && (
            <div className="ml-6 space-y-2 pl-3 border-l-2 border-accent-primary/30">
              <div>
                <label className="text-xs text-text-secondary block mb-1">Reasoning effort</label>
                <input
                  type="text"
                  value={modelConfigs[model.id]?.thinkingLevel ?? ''}
                  onChange={(e) => onUpdateConfig(model.id, { thinkingLevel: e.target.value })}
                  className="w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-xs text-text-primary"
                />
              </div>
              <QueryParamsInput
                value={modelConfigs[model.id]?.thinkingQueryParams}
                onChange={(v) => onUpdateConfig(model.id, { thinkingQueryParams: v })}
              />
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={modelConfigs[model.id]?.nonThinkingEnabled ?? false}
              onChange={(e) => onUpdateConfig(model.id, { nonThinkingEnabled: e.target.checked })}
              className="w-4 h-4 rounded border-border bg-bg-tertiary accent-accent-primary"
            />
            <span className="text-xs font-medium text-text-primary">Non-thinking</span>
          </label>
          {modelConfigs[model.id]?.nonThinkingEnabled && (
            <div className="ml-6 space-y-2 pl-3 border-l-2 border-accent-warning/30">
              <QueryParamsInput
                value={modelConfigs[model.id]?.nonThinkingQueryParams}
                onChange={(v) => onUpdateConfig(model.id, { nonThinkingQueryParams: v })}
              />
            </div>
          )}
        </div>

        <div className="border-t border-border pt-3 mt-3">
          <p className="text-xs text-text-muted mb-2">Sampling parameters</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-text-secondary block mb-0.5">Temperature</label>
              <input
                type="number"
                step="0.1"
                value={modelConfigs[model.id]?.temperature ?? ''}
                onChange={(e) =>
                  onUpdateConfig(model.id, {
                    temperature: e.target.value ? parseFloat(e.target.value) : undefined,
                  })
                }
                placeholder={modelConfigs[model.id]?.defaultTemperature?.toString() ?? 'Using default'}
                className="w-full px-2 py-1 bg-bg-tertiary border border-border rounded text-xs text-text-primary"
              />
              {modelConfigs[model.id]?.defaultTemperature !== undefined && (
                <p className="text-xs text-text-muted mt-0.5">default: {modelConfigs[model.id]?.defaultTemperature}</p>
              )}
            </div>
            <div>
              <label className="text-xs text-text-secondary block mb-0.5">Top P</label>
              <input
                type="number"
                step="0.05"
                value={modelConfigs[model.id]?.topP ?? ''}
                onChange={(e) =>
                  onUpdateConfig(model.id, {
                    topP: e.target.value ? parseFloat(e.target.value) : undefined,
                  })
                }
                placeholder={modelConfigs[model.id]?.defaultTopP?.toString() ?? 'Using default'}
                className="w-full px-2 py-1 bg-bg-tertiary border border-border rounded text-xs text-text-primary"
              />
              {modelConfigs[model.id]?.defaultTopP !== undefined && (
                <p className="text-xs text-text-muted mt-0.5">default: {modelConfigs[model.id]?.defaultTopP}</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div>
              <label className="text-xs text-text-secondary block mb-0.5">Top K</label>
              <input
                type="number"
                value={modelConfigs[model.id]?.topK ?? ''}
                onChange={(e) =>
                  onUpdateConfig(model.id, {
                    topK: e.target.value ? parseInt(e.target.value) : undefined,
                  })
                }
                placeholder={modelConfigs[model.id]?.defaultTopK?.toString() ?? 'Using default'}
                className="w-full px-2 py-1 bg-bg-tertiary border border-border rounded text-xs text-text-primary"
              />
              {modelConfigs[model.id]?.defaultTopK !== undefined && (
                <p className="text-xs text-text-muted mt-0.5">default: {modelConfigs[model.id]?.defaultTopK}</p>
              )}
            </div>
            <div>
              <label className="text-xs text-text-secondary block mb-0.5">Max tokens</label>
              <input
                type="number"
                value={modelConfigs[model.id]?.maxTokens ?? ''}
                onChange={(e) =>
                  onUpdateConfig(model.id, {
                    maxTokens: e.target.value ? parseInt(e.target.value) : undefined,
                  })
                }
                placeholder={modelConfigs[model.id]?.defaultMaxTokens?.toString() ?? 'Using default'}
                className="w-full px-2 py-1 bg-bg-tertiary border border-border rounded text-xs text-text-primary"
              />
              {modelConfigs[model.id]?.defaultMaxTokens !== undefined && (
                <p className="text-xs text-text-muted mt-0.5">default: {modelConfigs[model.id]?.defaultMaxTokens}</p>
              )}
            </div>
          </div>
        </div>
      </details>
    </div>
  )
}

export function ProviderModal({
  isOpen,
  onClose,
  onSave,
  initialStep = 1,
  editProvider,
  editModelId,
}: ProviderModalProps) {
  const [formStep, setFormStep] = useState(initialStep)
  const [formName, setFormName] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formBackend, setFormBackend] = useState<string>('unknown')
  const [formApiKey, setFormApiKey] = useState('')
  const [formIsLocal, setFormIsLocal] = useState(false)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null)
  const [showDefaults, setShowDefaults] = useState(false)
  const [thinkingField, setThinkingField] = useState('')
  const [modelConfigs, setModelConfigs] = useState<Record<string, ModelConfig>>({})
  const [autoConfigState, setAutoConfigState] = useState<{
    loading: boolean
    progress: Record<string, 'pending' | 'probing' | 'done' | 'error'>
  }>({ loading: false, progress: {} })
  const [testResults, setTestResults] = useState<
    Record<string, { loading: boolean; result?: string; message?: Record<string, unknown>; error?: string }>
  >({})
  const [rawModalData, setRawModalData] = useState<string | null>(null)
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const urlInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (formStep === 1 && isOpen) {
      // Small delay to ensure the input is mounted
      requestAnimationFrame(() => urlInputRef.current?.focus())
    }
  }, [formStep, isOpen])

  function updateModelConfig(id: string, partial: Partial<ModelConfig>) {
    setModelConfigs((prev) => ({ ...prev, [id]: { ...prev[id]!, ...partial } }))
  }

  function filterModels(query: string): ModelInfo[] {
    if (!query.trim()) return models
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    return models.filter((m) => terms.every((t) => m.id.toLowerCase().includes(t)))
  }

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormStep(initialStep)
      setFormName(editProvider?.name ?? '')
      setFormUrl(editProvider?.url ?? '')
      setFormBackend(editProvider?.backend ?? 'unknown')
      setFormApiKey(editProvider?.apiKey ?? '')
      setFormIsLocal(editProvider?.isLocal ?? false)
      setFetchError(null)
      setThinkingField(editProvider?.thinkingField ?? '')
      setTestResults({})
      setRawModalData(null)

      if (editProvider?.models?.length) {
        const configs: Record<string, ModelConfig> = {}
        const selected = new Set<string>()
        for (const m of editProvider.models) {
          configs[m.id] = {
            contextWindow: m.contextWindow,
            supportsVision: m.supportsVision,
            thinkingEnabled: m.thinkingEnabled,
            thinkingLevel: m.thinkingLevel,
            nonThinkingEnabled: m.nonThinkingEnabled,
            thinkingQueryParams: m.thinkingQueryParams,
            nonThinkingQueryParams: m.nonThinkingQueryParams,
            defaultTemperature: m.defaultTemperature,
            defaultTopP: m.defaultTopP,
            defaultTopK: m.defaultTopK,
            defaultMaxTokens: m.defaultMaxTokens,
          }
          if (m.selected) selected.add(m.id)
        }
        // Auto-select all models if none explicitly selected (legacy / single-model)
        if (selected.size === 0) {
          for (const m of editProvider.models) selected.add(m.id)
        }
        setSelectedModelIds(selected)
        setModelConfigs(configs)
        setModels(editProvider.models.map((m) => ({ id: m.id, contextWindow: m.contextWindow })))
        setExpandedModelId(editModelId ?? editProvider.models[0]?.id ?? null)
      } else {
        setModels([])
        setModelConfigs({})
        setExpandedModelId(null)
        setSelectedModelIds(new Set())
      }
    }
  }, [isOpen, initialStep, editProvider?.id, editModelId])

  // Auto-fetch models when entering step 2
  useEffect(() => {
    if (formStep === 2 && formUrl && models.length === 0 && !fetchingModels && !fetchError) {
      fetchModels(formUrl)
    }
  }, [formStep])

  async function fetchModels(url: string) {
    setFetchingModels(true)
    setFetchError(null)
    setModels([])
    try {
      const params = new URLSearchParams({ url })
      if (formApiKey) params.set('apiKey', formApiKey)
      const response = await authFetch(`/api/providers/models?${params.toString()}`)
      if (response.ok) {
        const data = (await response.json()) as { models: ModelInfo[]; url: string }
        if (data.models?.length) {
          setModels(data.models)
          setExpandedModelId(data.models[0]?.id ?? null)
          const configs: Record<string, ModelConfig> = {}
          for (const m of data.models) {
            configs[m.id] = {
              contextWindow: m.contextWindow,
              thinkingEnabled: true,
              thinkingLevel: undefined,
              defaultTemperature: (m as { defaultTemperature?: number }).defaultTemperature,
              defaultTopP: (m as { defaultTopP?: number }).defaultTopP,
              defaultTopK: (m as { defaultTopK?: number }).defaultTopK,
              defaultMaxTokens: (m as { defaultMaxTokens?: number }).defaultMaxTokens,
            }
          }
          setModelConfigs(configs)
          if (data.models.length === 1) {
            setSelectedModelIds(new Set([data.models[0]!.id]))
            setExpandedModelId(data.models[0]!.id)
            runAutoConfig(data.models[0]!.id)
          }
        }
      } else {
        const data = (await response.json()) as { error?: string; url?: string }
        setFetchError(data.error ?? `Failed to fetch models from ${url}`)
      }
    } catch (error) {
      setFetchError(`Failed to fetch models from ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
    setFetchingModels(false)
  }

  async function runAutoConfig(modelId: string) {
    setAutoConfigState((prev) => ({
      loading: true,
      progress: { ...prev.progress, [modelId]: 'probing' },
    }))
    try {
      const response = await authFetch('/api/providers/auto-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: formUrl,
          apiKey: formApiKey || undefined,
          backend: formBackend || 'unknown',
          models: [{ id: modelId }],
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error ?? 'Auto-config failed')
      }
      const data = (await response.json()) as {
        models: Array<{
          id: string
          contextWindow: number
          contextSource: 'backend' | 'hardcoded' | 'default'
          supportsVision: boolean
          thinkingConfig: Record<string, unknown> | null
          nonThinkingConfig: Record<string, unknown> | null
        }>
      }
      for (const m of data.models) {
        const config: Partial<ModelConfig> = {}
        // Only apply context/supportsvision when reliably detected
        if (m.contextSource !== 'default') {
          config.contextWindow = m.contextWindow
          config.supportsVision = m.supportsVision
        }
        if (m.thinkingConfig) {
          config.thinkingEnabled = true
          config.thinkingQueryParams = JSON.stringify(m.thinkingConfig)
        }
        if (m.nonThinkingConfig) {
          config.nonThinkingEnabled = true
          config.nonThinkingQueryParams = JSON.stringify(m.nonThinkingConfig)
        }
        updateModelConfig(m.id, config)
        setAutoConfigState((prev) => ({
          ...prev,
          progress: { ...prev.progress, [m.id]: 'done' },
        }))
      }
    } catch (error) {
      console.error('Auto-config error:', error)
      setAutoConfigState((prev) => ({
        ...prev,
        progress: { ...prev.progress, [modelId]: 'error' },
      }))
    } finally {
      setAutoConfigState((prev) => ({ ...prev, loading: false }))
    }
  }

  async function testParams(modelId: string, mode: 'thinking' | 'non-thinking') {
    const key = modelId + '-' + mode
    setTestResults((prev) => ({ ...prev, [key]: { loading: true } }))
    try {
      const config = modelConfigs[modelId]
      const response = await authFetch('/api/providers/test-params', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: formUrl,
          model: modelId,
          apiKey: formApiKey || undefined,
          backend: formBackend || 'unknown',
          thinkingField: thinkingField || undefined,
          mode,
          modelConfig: {
            temperature: config?.temperature,
            topP: config?.topP,
            topK: config?.topK,
            maxTokens: config?.maxTokens,
            supportsVision: config?.supportsVision,
            thinkingEnabled: config?.thinkingEnabled,
            thinkingLevel: config?.thinkingLevel,
            nonThinkingEnabled: config?.nonThinkingEnabled,
            thinkingQueryParams: config?.thinkingQueryParams,
            nonThinkingQueryParams: config?.nonThinkingQueryParams,
          },
        }),
      })
      const data = await response.json()
      if (response.ok) {
        setTestResults((prev) => ({
          ...prev,
          [key]: { loading: false, result: JSON.stringify(data, null, 2), message: data.message },
        }))
      } else {
        setTestResults((prev) => ({ ...prev, [key]: { loading: false, error: data.error ?? 'Test failed' } }))
      }
    } catch (error) {
      setTestResults((prev) => ({
        ...prev,
        [key]: { loading: false, error: error instanceof Error ? error.message : 'Request failed' },
      }))
    }
  }

  function resetStep2() {
    setModels([])
    setModelConfigs({})
    setAutoConfigState({ loading: false, progress: {} })
    setTestResults({})
    setRawModalData(null)
    setSelectedModelIds(new Set())
    setSearchQuery('')
  }

  function handleSave() {
    const name = formName || `Provider`
    const providerId = editProvider?.id ?? `temp-${Date.now()}`
    onSave({
      id: providerId,
      name,
      url: formUrl,
      backend: (formBackend || 'unknown') as Backend,
      apiKey: formApiKey || undefined,
      isLocal: formIsLocal || undefined,
      thinkingField: thinkingField || undefined,
      models: models.map((m) => ({
        id: m.id,
        contextWindow: modelConfigs[m.id]?.contextWindow ?? m.contextWindow,
        selected: selectedModelIds.has(m.id) || undefined,
        supportsVision: modelConfigs[m.id]?.supportsVision,
        thinkingEnabled: modelConfigs[m.id]?.thinkingEnabled,
        thinkingLevel: modelConfigs[m.id]?.thinkingLevel,
        nonThinkingEnabled: modelConfigs[m.id]?.nonThinkingEnabled,
        thinkingQueryParams: modelConfigs[m.id]?.thinkingQueryParams,
        nonThinkingQueryParams: modelConfigs[m.id]?.nonThinkingQueryParams,
        temperature: modelConfigs[m.id]?.temperature,
        topP: modelConfigs[m.id]?.topP,
        topK: modelConfigs[m.id]?.topK,
        maxTokens: modelConfigs[m.id]?.maxTokens,
      })),
    })
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-bg-secondary border border-border rounded-xl w-[640px] max-h-[85vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-lg font-semibold text-text-primary">{editProvider ? 'Edit Provider' : 'Add Provider'}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xl leading-none p-1">
            &times;
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-1.5 px-6 pt-4">
          {[1, 2].map((s) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${
                s < formStep ? 'bg-accent-success' : s === formStep ? 'bg-accent-primary' : 'bg-border'
              }`}
            />
          ))}
        </div>

        {/* Step 1: Basic Info */}
        {formStep === 1 && (
          <div className="px-6 py-4 space-y-4">
            <div>
              <label className="block text-sm text-text-secondary mb-2">Inference engine</label>
              <div className="grid grid-cols-4 gap-2">
                <button
                  key="other"
                  type="button"
                  onClick={() => {
                    setFormBackend('unknown')
                    setFormIsLocal(false)
                    setFetchError(null)
                  }}
                  className={`p-2 rounded border text-center text-sm transition-colors ${
                    formBackend === 'unknown'
                      ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                      : 'border-border hover:border-text-muted text-text-secondary'
                  }`}
                >
                  Other
                </button>
                {COMMON_PORTS.map((port) => {
                  const backendMap: Record<number, string> = {
                    8000: 'vllm',
                    11434: 'ollama',
                    8080: 'llamacpp',
                  }
                  const nameMap: Record<number, string> = {
                    8000: 'vLLM',
                    11434: 'Ollama',
                    8080: 'llama.cpp',
                  }
                  return (
                    <button
                      key={port}
                      type="button"
                      onClick={() => {
                        setFormName((prev) => prev || (nameMap[port] ?? ''))
                        setFormUrl((prev) => prev || `http://localhost:${port}`)
                        setFormBackend(backendMap[port] ?? '')
                        setFormIsLocal(true)
                        setFetchError(null)
                      }}
                      className={`p-2 rounded border text-center text-sm transition-colors ${
                        formBackend === backendMap[port]
                          ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                          : 'border-border hover:border-text-muted text-text-secondary'
                      }`}
                    >
                      {nameMap[port] ?? `localhost:${port}`}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm text-text-secondary mb-1">Provider URL</label>
              <input
                ref={urlInputRef}
                type="text"
                value={formUrl}
                data-testid="provider-modal-url"
                onChange={(e) => {
                  setFormUrl(e.target.value)
                  setFetchError(null)
                  setModels([])
                  setModelConfigs({})
                }}
                placeholder="http://localhost:8000"
                className="w-full px-4 py-2 bg-bg-primary border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
              />
            </div>

            <div>
              <label className="block text-sm text-text-secondary mb-1">Provider name</label>
              <input
                type="text"
                autoComplete="off"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="My LLM Server"
                className="w-full px-4 py-2 bg-bg-primary border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
              />
            </div>

            <div>
              <label className="block text-sm text-text-secondary mb-1">
                API key <span className="text-text-muted">(optional)</span>
              </label>
              <input
                type="text"
                autoComplete="off"
                value={formApiKey}
                onChange={(e) => setFormApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full px-4 py-2 bg-bg-primary border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formIsLocal}
                onChange={(e) => setFormIsLocal(e.target.checked)}
                className="w-4 h-4 rounded border-border bg-bg-primary accent-accent-primary"
              />
              <span className="text-sm text-text-secondary">This is a local provider</span>
            </label>
          </div>
        )}

        {/* Step 2: Test & Configure Models */}
        {formStep === 2 && (
          <div className="px-6 py-4 space-y-4">
            {fetchingModels && (
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <span className="w-4 h-4 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
                Fetching models...
              </div>
            )}
            {fetchError && (
              <div className="p-3 rounded-lg text-sm bg-red-500/10 text-red-500 border border-red-500/20">
                <p>{fetchError}</p>
                <p className="text-xs text-text-muted mt-1">URL: {formUrl}</p>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => fetchModels(formUrl)} className="text-xs text-accent-primary hover:underline">
                    Retry
                  </button>
                  <button
                    onClick={() => {
                      resetStep2()
                      setFormStep(1)
                    }}
                    className="text-xs text-accent-primary hover:underline"
                  >
                    Edit URL
                  </button>
                </div>
              </div>
            )}

            {models.length > 0 && formBackend && (
              <>
                {/* Selected Models — full config panels */}
                {selectedModelIds.size > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-text-primary mb-1">
                      Selected Models ({selectedModelIds.size})
                    </h4>
                    <p className="text-xs text-text-muted mb-2">
                      Only selected models will appear in the model selector.
                    </p>
                    <div className="space-y-2">
                      {models
                        .filter((m) => selectedModelIds.has(m.id))
                        .map((model) => (
                          <div key={model.id} className="bg-bg-primary border border-border rounded-lg overflow-hidden">
                            <div
                              onClick={() => setExpandedModelId(expandedModelId === model.id ? null : model.id)}
                              className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-tertiary transition-colors cursor-pointer"
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-medium text-text-primary">
                                  {model.id.split('/').pop()}
                                </span>
                                <span className="text-xs text-text-muted bg-bg-tertiary px-2 py-0.5 rounded">
                                  {(modelConfigs[model.id]?.contextWindow ?? model.contextWindow).toLocaleString()} ctx
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                {autoConfigState.progress[model.id] === 'probing' ? (
                                  <span className="w-3 h-3 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
                                ) : autoConfigState.progress[model.id] === 'done' ? (
                                  <span className="text-xs text-accent-success font-medium">Configured ✓</span>
                                ) : autoConfigState.progress[model.id] === 'error' ? (
                                  <span className="text-xs text-red-500 font-medium">Failed ✗</span>
                                ) : (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      runAutoConfig(model.id)
                                    }}
                                    className="text-xs text-accent-primary hover:underline"
                                  >
                                    Auto-config
                                  </button>
                                )}
                                {models.length > 1 && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      const next = new Set(selectedModelIds)
                                      next.delete(model.id)
                                      setSelectedModelIds(next)
                                      if (expandedModelId === model.id) setExpandedModelId(null)
                                    }}
                                    className="text-xs text-red-500 hover:text-red-400 px-2 py-1 rounded hover:bg-red-500/10"
                                  >
                                    Remove
                                  </button>
                                )}
                                <ChevronDownIcon
                                  className={`w-4 h-4 text-text-muted transition-transform ${expandedModelId === model.id ? 'rotate-180' : ''}`}
                                />
                              </div>
                            </div>

                            {expandedModelId === model.id && (
                              <ModelConfigPanel
                                model={model}
                                modelConfigs={modelConfigs}
                                autoConfigState={autoConfigState}
                                testResults={testResults}
                                onUpdateConfig={updateModelConfig}
                                onRunAutoConfig={runAutoConfig}
                                onTestParams={testParams}
                                onShowRaw={setRawModalData}
                              />
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Available Models — search + checkbox list (hidden when single model, already selected) */}
                {models.length > 1 && (
                  <div>
                    <h4 className="text-sm font-medium text-text-primary mb-1">Available Models</h4>
                    {selectedModelIds.size === 0 && (
                      <p className="text-xs text-text-muted mb-2">
                        This provider has many models available. Select the ones you want to use below.
                      </p>
                    )}

                    <div className="relative mb-2">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search models..."
                        className="w-full px-4 py-2 bg-bg-primary border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary text-sm"
                        >
                          &times;
                        </button>
                      )}
                    </div>

                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-text-muted">
                        Showing {filterModels(searchQuery).length} of {models.length} models
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            const next = new Set(selectedModelIds)
                            const visible = filterModels(searchQuery)
                            for (const m of visible) next.add(m.id)
                            setSelectedModelIds(next)
                            for (const m of visible) {
                              if (
                                autoConfigState.progress[m.id] !== 'probing' &&
                                autoConfigState.progress[m.id] !== 'done'
                              ) {
                                runAutoConfig(m.id)
                              }
                            }
                          }}
                          className="text-xs text-accent-primary hover:underline"
                        >
                          Select all
                        </button>
                        <button
                          onClick={() => {
                            const next = new Set(selectedModelIds)
                            const visible = filterModels(searchQuery)
                            for (const m of visible) next.delete(m.id)
                            setSelectedModelIds(next)
                          }}
                          className="text-xs text-text-muted hover:text-text-secondary"
                        >
                          Deselect all
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1 max-h-48 overflow-y-auto border border-border rounded-lg bg-bg-primary">
                      {filterModels(searchQuery).map((model) => {
                        const isChecked = selectedModelIds.has(model.id)
                        return (
                          <div
                            key={model.id}
                            role="checkbox"
                            aria-checked={isChecked}
                            tabIndex={0}
                            className={`flex items-center gap-3 px-4 py-2 hover:bg-bg-tertiary transition-colors cursor-pointer ${
                              isChecked ? 'bg-accent-primary/5' : ''
                            }`}
                            onClick={() => {
                              if (isChecked) {
                                const next = new Set(selectedModelIds)
                                next.delete(model.id)
                                setSelectedModelIds(next)
                              } else {
                                const next = new Set(selectedModelIds)
                                next.add(model.id)
                                setSelectedModelIds(next)
                                runAutoConfig(model.id)
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                e.currentTarget.click()
                              }
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              className="w-4 h-4 rounded border-border accent-accent-primary pointer-events-none"
                            />
                            <span className="text-sm text-text-primary flex-1 truncate">
                              {model.id.split('/').pop()}
                            </span>
                            <span className="text-xs text-text-muted flex-shrink-0">
                              {(modelConfigs[model.id]?.contextWindow ?? model.contextWindow).toLocaleString()} ctx
                            </span>
                            {autoConfigState.progress[model.id] === 'probing' && (
                              <span className="w-3 h-3 border-2 border-accent-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
                            )}
                            {autoConfigState.progress[model.id] === 'done' && (
                              <span className="text-xs text-accent-success flex-shrink-0">✓</span>
                            )}
                            {autoConfigState.progress[model.id] === 'error' && (
                              <span className="text-xs text-red-500 flex-shrink-0">✗</span>
                            )}
                          </div>
                        )
                      })}
                      {filterModels(searchQuery).length === 0 && (
                        <div className="px-4 py-6 text-center text-sm text-text-muted">
                          No models match &ldquo;{searchQuery}&rdquo;
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border">
          <div>
            {formStep > 1 && (
              <button
                onClick={() => {
                  if (formStep === 2) resetStep2()
                  setFormStep((formStep - 1) as 1 | 2)
                }}
                className="text-sm text-text-muted hover:text-text-secondary transition-colors"
              >
                ← Back
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-text-muted hover:text-text-secondary transition-colors"
            >
              Cancel
            </button>
            {formStep === 1 ? (
              <button
                onClick={() => setFormStep(2)}
                disabled={!formUrl}
                data-testid="provider-modal-next"
                className="px-5 py-2 bg-accent-primary text-text-primary rounded-lg text-sm font-medium hover:bg-accent-primary/90 disabled:opacity-50 transition-colors"
              >
                Next — Test &amp; Configure
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={autoConfigState.loading}
                data-testid="provider-modal-save"
                className="px-5 py-2 bg-accent-primary text-text-primary rounded-lg text-sm font-medium hover:bg-accent-primary/90 disabled:opacity-50 transition-colors"
              >
                {autoConfigState.loading ? 'Configuring...' : 'Save Provider'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Provider defaults modal */}
      {showDefaults && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowDefaults(false)
          }}
        >
          <div className="bg-bg-secondary border border-border rounded-xl w-[480px] shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-base font-semibold text-text-primary">Provider-Level Defaults</h3>
              <button
                onClick={() => setShowDefaults(false)}
                className="text-text-muted hover:text-text-primary text-xl leading-none p-1"
              >
                &times;
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <p className="text-xs text-text-muted">These apply to all models unless overridden per-model.</p>
              <div>
                <label className="text-xs text-text-secondary block mb-1">Non-thinking mode params</label>
                <input
                  type="text"
                  defaultValue='{"chat_template_kwargs":{"enable_thinking":false}}'
                  readOnly
                  className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-sm text-text-secondary font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary block mb-1">Thinking mode params</label>
                <input
                  type="text"
                  defaultValue='reasoning_effort: "low"'
                  readOnly
                  className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-sm text-text-secondary font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary block mb-1">
                  Thinking response field <span className="text-text-muted">(override)</span>
                </label>
                <input
                  type="text"
                  value={thinkingField}
                  onChange={(e) => setThinkingField(e.target.value)}
                  placeholder="Leave blank for auto-detect"
                  className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-sm text-text-primary font-mono"
                />
                <p className="text-xs text-text-muted mt-1">
                  Field name the backend uses for reasoning/thinking content (e.g. reasoning, reasoning_content,
                  thinking).
                </p>
              </div>
            </div>
            <div className="flex justify-end px-6 py-4 border-t border-border">
              <button
                onClick={() => setShowDefaults(false)}
                className="px-5 py-2 bg-accent-primary text-text-primary rounded-lg text-sm font-medium hover:bg-accent-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Raw response modal */}
      {rawModalData && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRawModalData(null)
          }}
        >
          <div className="bg-bg-secondary border border-border rounded-xl w-[640px] max-h-[80vh] shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <h3 className="text-base font-semibold text-text-primary">Raw Response</h3>
              <button
                onClick={() => setRawModalData(null)}
                className="text-text-muted hover:text-text-primary text-xl leading-none p-1"
              >
                &times;
              </button>
            </div>
            <pre className="px-6 py-4 overflow-y-auto text-xs text-text-secondary font-mono whitespace-pre-wrap break-all">
              {rawModalData}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
