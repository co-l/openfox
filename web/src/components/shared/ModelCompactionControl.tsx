import { useEffect, useState } from 'react'
import { useConfigStore } from '../../stores/config'
import { formatTokens } from '../../lib/format-stats'

const DEFAULT_THRESHOLD = 0.85
const MAX_THRESHOLD_PERCENT = 95
const MIN_THRESHOLD_TOKENS = 15_000

interface ModelCompactionControlProps {
  providerId: string
  modelId: string
  maxTokens: number
  compact?: boolean
}

export function ModelCompactionControl({
  providerId,
  modelId,
  maxTokens,
  compact = false,
}: ModelCompactionControlProps) {
  const providers = useConfigStore((state) => state.providers)
  const setModelCompactionThreshold = useConfigStore((state) => state.setModelCompactionThreshold)
  const model = providers.find((provider) => provider.id === providerId)?.models.find((item) => item.id === modelId)
  const configuredThreshold = model?.compactionThreshold
  const effectiveThreshold = configuredThreshold ?? DEFAULT_THRESHOLD
  const minimumPercent = Math.min(MAX_THRESHOLD_PERCENT, Math.ceil((MIN_THRESHOLD_TOKENS / maxTokens) * 100))
  const [percent, setPercent] = useState(Math.max(minimumPercent, Math.round(effectiveThreshold * 100)))

  useEffect(() => {
    setPercent(Math.max(minimumPercent, Math.round(effectiveThreshold * 100)))
  }, [effectiveThreshold, minimumPercent])

  const commit = () => void setModelCompactionThreshold(providerId, modelId, percent / 100)
  const thresholdTokens = Math.max(MIN_THRESHOLD_TOKENS, Math.floor(maxTokens * (percent / 100)))

  return (
    <div className={compact ? 'border-t border-border px-3 py-2' : ''}>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div>
          <div className={compact ? 'text-xs text-text-muted' : 'text-sm font-medium text-text-primary'}>
            Auto-compaction
          </div>
          {!compact && <div className="mt-0.5 text-sm text-text-muted">Threshold for {modelId}.</div>}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-text-primary">
            {percent}% · {formatTokens(thresholdTokens)}
          </span>
          <button
            type="button"
            onClick={() => void setModelCompactionThreshold(providerId, modelId, null)}
            disabled={configuredThreshold === undefined}
            className="text-xs text-accent-primary hover:underline disabled:text-text-muted disabled:no-underline"
          >
            Default
          </button>
        </div>
      </div>
      <input
        aria-label={`Auto-compaction threshold for ${modelId}`}
        type="range"
        min={minimumPercent}
        max={MAX_THRESHOLD_PERCENT}
        step="1"
        value={percent}
        onChange={(event) => setPercent(Number(event.target.value))}
        onMouseUp={commit}
        onTouchEnd={commit}
        onBlur={commit}
        onKeyUp={commit}
        className="w-full"
      />
      <div className="mt-1 text-[10px] text-text-muted">
        Minimum {formatTokens(MIN_THRESHOLD_TOKENS)} tokens · maximum {MAX_THRESHOLD_PERCENT}% · default 85%
      </div>
    </div>
  )
}
