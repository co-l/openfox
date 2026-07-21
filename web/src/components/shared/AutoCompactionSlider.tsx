import { formatTokens } from '../../lib/format-stats'

interface AutoCompactionSliderProps {
  percent: number
  minimumPercent: number
  minimumTokens: number
  locked: boolean
  compact?: boolean
  onChange: (percent: number) => void
  onCommit: () => void
}

export function AutoCompactionSlider({
  percent,
  minimumPercent,
  minimumTokens,
  locked,
  compact = false,
  onChange,
  onCommit,
}: AutoCompactionSliderProps) {
  const textClass = compact ? 'text-[10px]' : 'text-xs'

  return (
    <>
      <input
        aria-label="Auto-compaction threshold"
        type="range"
        min="0"
        max="100"
        step="1"
        value={percent}
        disabled={locked}
        onChange={(event) => onChange(Number(event.target.value))}
        onMouseUp={onCommit}
        onTouchEnd={onCommit}
        onBlur={onCommit}
        onKeyUp={onCommit}
        className="w-full disabled:opacity-50"
      />
      {minimumPercent > 0 && (
        <div className={`${textClass} text-text-muted mt-1`}>
          Minimum: {minimumPercent}% · ~{formatTokens(minimumTokens)} tokens
        </div>
      )}
      {locked && (
        <div className={`${textClass} text-accent-warning mt-1`}>
          Controlled by OPENFOX_COMPACTION_THRESHOLD
          {!compact && '. Change the environment variable and restart OpenFox.'}
        </div>
      )}
    </>
  )
}
