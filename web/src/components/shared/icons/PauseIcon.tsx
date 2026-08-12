interface PauseIconProps {
  className?: string
  color?: string
}

export function PauseIcon({ className = 'w-4 h-4', color }: PauseIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill={color ?? 'currentColor'}>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  )
}
