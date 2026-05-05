import { getProgressColor } from '../plan/token-utils.js'

interface ProgressBarProps {
  percent: number
  dangerZone?: boolean
  size?: 'sm' | 'md'
  className?: string
}

export function ProgressBar({ percent, dangerZone = false, size = 'md', className = '' }: ProgressBarProps) {
  const width = size === 'sm' ? 'w-12' : 'w-20'
  const height = size === 'sm' ? 'h-1' : 'h-1.5'

  return (
    <div className={`${height} bg-bg-tertiary rounded-full overflow-hidden ${width} ${className}`}>
      <div
        className={`h-full transition-all duration-300 ${getProgressColor(percent, dangerZone)}`}
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  )
}

interface LowTokenWarningProps {
  dangerZone: boolean
  size?: 'sm' | 'md'
}

export function LowTokenWarning({ dangerZone, size = 'md' }: LowTokenWarningProps) {
  if (!dangerZone) return null
  return (
    <span className={`text-accent-error animate-pulse ${size === 'sm' ? 'text-[10px]' : 'text-[10px]'} font-medium`}>
      Low!
    </span>
  )
}
