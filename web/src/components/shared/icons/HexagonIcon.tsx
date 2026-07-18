interface HexagonIconProps {
  className?: string
}

export function HexagonIcon({ className = 'w-4 h-4' }: HexagonIconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <polygon points="12.5,8 10.25,11.9 5.75,11.9 3.5,8 5.75,4.1 10.25,4.1" />
    </svg>
  )
}
