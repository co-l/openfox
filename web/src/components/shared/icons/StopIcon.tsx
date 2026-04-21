interface StopIconProps {
  className?: string
}

export function StopIcon({ className = 'w-4 h-4' }: StopIconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <rect x="3" y="3" width="10" height="10" rx="1" />
    </svg>
  )
}