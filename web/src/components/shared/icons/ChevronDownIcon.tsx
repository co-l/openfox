interface ChevronDownIconProps {
  className?: string
  rotate?: number
}

export function ChevronDownIcon({ className = 'w-3 h-3 text-text-muted', rotate }: ChevronDownIconProps) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      style={rotate !== undefined ? { transform: `rotate(${rotate}deg)` } : undefined}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}
