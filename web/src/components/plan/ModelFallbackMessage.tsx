import type { ModelCascadeFallback } from '@shared/types.js'

export function ModelFallbackMessage({ providerId, providerName, model, error }: ModelCascadeFallback) {
  const provider = providerName || providerId

  return (
    <div className="feed-item rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
      <span className="font-medium text-amber-300">Model failed</span>
      <span className="text-text-secondary">
        {' '}
        · {provider} / {model} · trying next configured model
      </span>
      <div className="mt-1 whitespace-pre-wrap text-amber-200">{error}</div>
    </div>
  )
}
