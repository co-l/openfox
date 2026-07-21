import type { CompactionFloorSegment } from '@shared/types.js'
import { formatTokens } from '../../lib/format-stats'

type VisualSegmentKey = CompactionFloorSegment['key'] | 'conversation' | 'free'

const SEGMENT_STYLES: Record<VisualSegmentKey, { bar: string; dot: string }> = {
  system: { bar: 'bg-accent-primary', dot: 'bg-accent-primary' },
  instructions: { bar: 'bg-orange-500', dot: 'bg-orange-500' },
  skills: { bar: 'bg-accent-success', dot: 'bg-accent-success' },
  subagents: { bar: 'bg-blue-600', dot: 'bg-blue-600' },
  tools: { bar: 'bg-purple-500', dot: 'bg-purple-500' },
  mcp: { bar: 'bg-yellow-500', dot: 'bg-yellow-500' },
  conversation: { bar: 'bg-rose-500', dot: 'bg-rose-500' },
  free: { bar: 'bg-bg-tertiary', dot: 'bg-bg-tertiary border border-border' },
}

interface CompactionFloorBarProps {
  segments: CompactionFloorSegment[]
  maxTokens: number
  currentTokens?: number
  compact?: boolean
  showDetails?: boolean
}

export function CompactionFloorBar({
  segments,
  maxTokens,
  currentTokens = 0,
  compact = false,
  showDetails = false,
}: CompactionFloorBarProps) {
  const totalTokens = segments.reduce((total, segment) => total + segment.tokens, 0)
  if (totalTokens <= 0 || maxTokens <= 0) return null

  const conversationTokens = Math.max(0, currentTokens - totalTokens)
  const usedTokens = Math.min(maxTokens, totalTokens + conversationTokens)
  const freeTokens = Math.max(0, maxTokens - usedTokens)
  const fullContextSegments: Array<{ key: VisualSegmentKey; label: string; tokens: number }> = [
    ...segments,
    ...(conversationTokens > 0
      ? [{ key: 'conversation' as const, label: 'Current conversation', tokens: conversationTokens }]
      : []),
    ...(freeTokens > 0 ? [{ key: 'free' as const, label: 'Free context', tokens: freeTokens }] : []),
  ]

  const displayedSegments = compact && !showDetails ? segments : fullContextSegments
  const usedPercent = Math.min(100, Math.round((usedTokens / maxTokens) * 100))

  return (
    <div className={compact ? 'mt-1.5' : 'mt-3'}>
      {(!compact || showDetails) && (
        <div className={`${compact ? 'text-[11px]' : 'text-sm'} text-text-primary mb-2`}>
          {usedPercent}% Full · estimated breakdown
        </div>
      )}
      <div
        className={`flex overflow-hidden rounded bg-bg-tertiary ${compact ? 'h-2' : 'h-5'}`}
        aria-label={`Incompressible context: ${formatTokens(totalTokens)} tokens`}
      >
        {displayedSegments.map((segment) => {
          const modelPercent = (segment.tokens / maxTokens) * 100
          const visualPercent = compact && !showDetails ? (segment.tokens / totalTokens) * 100 : modelPercent
          return (
            <div
              key={segment.key}
              className={`${SEGMENT_STYLES[segment.key].bar} min-w-px`}
              style={{ width: `${visualPercent}%` }}
              title={
                compact && !showDetails
                  ? `${segment.label}: ~${formatTokens(segment.tokens)} tokens · ${modelPercent.toFixed(1)}% of model · ${visualPercent.toFixed(1)}% of minimum`
                  : `${segment.label}: ~${formatTokens(segment.tokens)} tokens · ${modelPercent.toFixed(1)}% of model`
              }
            />
          )
        })}
      </div>

      {(!compact || showDetails) && (
        <div className={compact ? 'space-y-1.5 mt-2' : 'grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1.5 mt-3'}>
          {displayedSegments.map((segment) => {
            const modelPercent = (segment.tokens / maxTokens) * 100
            return (
              <div
                key={segment.key}
                className={`flex items-center justify-between gap-3 ${compact ? 'text-[11px]' : 'text-xs'}`}
              >
                <span className="flex items-center gap-2 text-text-secondary min-w-0">
                  <span className={`w-2.5 h-2.5 rounded-sm flex-shrink-0 ${SEGMENT_STYLES[segment.key].dot}`} />
                  <span className="truncate">{segment.label}</span>
                </span>
                <span className="font-mono text-text-muted whitespace-nowrap">
                  ~{formatTokens(segment.tokens)} · {modelPercent.toFixed(1)}%
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
