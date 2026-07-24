interface ChevronIconProps {
  className?: string
  rotate?: number
  direction?: 'up' | 'down'
}

function ChevronIcon({ className = 'w-3 h-3 text-text-muted', rotate, direction = 'down' }: ChevronIconProps) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      style={rotate !== undefined ? { transform: `rotate(${rotate}deg)` } : undefined}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={direction === 'up' ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
    </svg>
  )
}

export function ChevronDownIcon(props: Omit<ChevronIconProps, 'direction'>) {
  return <ChevronIcon direction="down" {...props} />
}

export function ChevronUpIcon(props: Omit<ChevronIconProps, 'direction'>) {
  return <ChevronIcon direction="up" {...props} />
}
