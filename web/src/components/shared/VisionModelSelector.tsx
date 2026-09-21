import { type ReactNode, useMemo } from 'react'
import type { Provider } from '../../stores/config'
import { useT } from '../../hooks/useT'

export interface VisionModelOption {
  providerId: string
  providerName: string
  modelId: string
  modelName: string
}

export function getModelDisplayName(modelId: string): string {
  return modelId.split('/').pop()?.replace(/-/g, ' ') ?? modelId
}

export function useVisionModelOptions(providers: Provider[]): VisionModelOption[] {
  return useMemo(() => {
    const options: VisionModelOption[] = []
    for (const provider of providers) {
      for (const m of provider.models) {
        if (m.supportsVision) {
          options.push({
            providerId: provider.id,
            providerName: provider.name,
            modelId: m.id,
            modelName: m.name ?? getModelDisplayName(m.id),
          })
        }
      }
    }
    return options
  }, [providers])
}

export interface ProviderModelSelectProps {
  value: string
  options: VisionModelOption[]
  onChange: (ref: string) => void
  className?: string
}

export function ProviderModelSelect({ value, options, onChange, className }: ProviderModelSelectProps) {
  const t = useT()
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={
        className ??
        'w-full px-4 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent-primary'
      }
    >
      <option value="">{t({ en: 'Manual configuration...', fr: 'Configuration manuelle...' })}</option>
      {options.map((opt) => (
        <option key={`${opt.providerId}/${opt.modelId}`} value={`${opt.providerId}/${opt.modelId}`}>
          {`${opt.providerName} • ${opt.modelName}`}
        </option>
      ))}
    </select>
  )
}

export interface ManualVisionConfigProps {
  backend: 'ollama' | 'openai'
  url: string
  model: string
  apiKey: string
  onBackendChange: (backend: 'ollama' | 'openai') => void
  onUrlChange: (url: string) => void
  onModelChange: (model: string) => void
  onApiKeyChange: (apiKey: string) => void
}

export function ManualVisionConfig({
  backend,
  url,
  model,
  apiKey,
  onBackendChange,
  onUrlChange,
  onModelChange,
  onApiKeyChange,
}: ManualVisionConfigProps) {
  const t = useT()
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm text-text-secondary mb-1">
          {t({ en: 'Backend type', fr: 'Type de backend' })}
        </label>
        <select
          value={backend}
          onChange={(e) => onBackendChange(e.target.value as 'ollama' | 'openai')}
          className="w-full px-4 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent-primary"
        >
          <option value="ollama">{t({ en: 'Ollama', fr: 'Ollama' })}</option>
          <option value="openai">
            {t({
              en: 'OpenAI-compatible (vLLM, sglang, llama.cpp)',
              fr: 'Compatible OpenAI (vLLM, sglang, llama.cpp)',
            })}
          </option>
        </select>
      </div>

      <div>
        <label className="block text-sm text-text-secondary mb-1">
          {t({ en: 'Vision server URL', fr: 'URL du serveur de vision' })}
        </label>
        <input
          type="text"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder={backend === 'ollama' ? 'http://localhost:11434' : 'http://localhost:8000/v1'}
          className="w-full px-4 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
        />
      </div>

      <div>
        <label className="block text-sm text-text-secondary mb-1">
          {t({ en: 'Vision model name', fr: 'Nom du modèle de vision' })}
        </label>
        <input
          type="text"
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          placeholder={backend === 'ollama' ? 'qwen3.5:0.8b' : 'qwen3.5-27b'}
          className="w-full px-4 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
        />
      </div>

      {backend === 'openai' && (
        <div>
          <label className="block text-sm text-text-secondary mb-1">
            {t({ en: 'API key (optional)', fr: 'Clé API (facultatif)' })}
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder={t({
              en: 'Leave empty for a local server that needs no auth',
              fr: 'Laissez vide pour un serveur local qui ne nécessite pas d’authentification',
            })}
            className="w-full px-4 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
          />
        </div>
      )}
    </div>
  )
}

export function useBackendChangeHandler(
  setBackend: (b: 'ollama' | 'openai') => void,
  setSelectedRef: (ref: string) => void,
  setUrl: (url: string) => void,
  setModel: (model: string) => void,
): (newBackend: 'ollama' | 'openai') => void {
  return (newBackend: 'ollama' | 'openai') => {
    setBackend(newBackend)
    setSelectedRef('')
    if (newBackend === 'ollama') {
      setUrl('http://localhost:11434')
      setModel('qwen3.5:0.8b')
    } else {
      setUrl('http://localhost:8000/v1')
      setModel('qwen3.5-27b')
    }
  }
}

export function useProviderModelSelectHandler(
  setSelectedRef: (ref: string) => void,
  setUrl: (url: string) => void,
  setModel: (model: string) => void,
): (ref: string) => void {
  return (ref: string) => {
    setSelectedRef(ref)
    if (ref) {
      setUrl('')
      setModel('')
    }
  }
}

export interface VisionModelConfigSectionProps extends ManualVisionConfigProps {
  enabled: boolean
  hasOptions: boolean
  selectedRef: string
  visionModelOptions: VisionModelOption[]
  onProviderModelSelect: (ref: string) => void
  noOptionsMessage: string
  children?: ReactNode
}

export function VisionModelConfigSection({
  enabled,
  hasOptions,
  selectedRef,
  visionModelOptions,
  onProviderModelSelect,
  noOptionsMessage,
  children,
  ...manualConfig
}: VisionModelConfigSectionProps) {
  const t = useT()
  if (!enabled) return null

  return (
    <div className="space-y-4 pl-8">
      {hasOptions ? (
        <div>
          <label className="block text-sm text-text-secondary mb-1">
            {t({ en: 'Vision model from your providers', fr: 'Modèle de vision depuis vos fournisseurs' })}
          </label>
          <ProviderModelSelect value={selectedRef} options={visionModelOptions} onChange={onProviderModelSelect} />
        </div>
      ) : (
        <p className="text-sm text-text-muted italic">{noOptionsMessage}</p>
      )}

      <ManualVisionConfig {...manualConfig} />

      {children}
    </div>
  )
}
