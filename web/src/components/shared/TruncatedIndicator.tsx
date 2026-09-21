import { memo } from 'react'
import { useT } from '../../hooks/useT'

interface TruncatedIndicatorProps {
  className?: string
}

export const TruncatedIndicator = memo(function TruncatedIndicator({ className = '' }: TruncatedIndicatorProps) {
  const t = useT()
  return (
    <div className={`text-[10px] text-accent-warning ${className}`}>
      {t({ en: 'Output truncated', fr: 'Sortie tronquée' })}
    </div>
  )
})
