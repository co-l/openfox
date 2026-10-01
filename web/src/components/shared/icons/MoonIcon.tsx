interface MoonIconProps {
  className?: string
  color?: string
}

export function MoonIcon({ className = 'w-4 h-4', color }: MoonIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill={color ?? 'currentColor'}>
      <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 8.5 8.5 0 1 0 21 14.5Z" />
    </svg>
  )
}
