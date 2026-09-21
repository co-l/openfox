import type { CSSProperties } from 'react'
import { ChevronDownIcon } from './icons'
import { useT } from '../../hooks/useT'

interface AutoScrollToggleProps {
  isActive: boolean
  onToggle: (active: boolean) => void
  className?: string
  style?: CSSProperties
}

export function AutoScrollToggle({ isActive, onToggle, className, style }: AutoScrollToggleProps) {
  const t = useT()
  return (
    <button type="button" onClick={() => onToggle(!isActive)} className={className} style={style}>
      {isActive ? (
        <span className="w-1.5 h-1.5 rounded-full bg-accent-success" />
      ) : (
        <ChevronDownIcon className="w-3 h-3" />
      )}
      {isActive ? t({ en: 'Live', fr: 'Live' }) : t({ en: 'Scroll to bottom', fr: 'Défiler en bas' })}
    </button>
  )
}
