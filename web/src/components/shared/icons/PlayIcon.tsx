interface PlayIconProps {
  className?: string
  color?: string
}

export function PlayIcon({ className = 'w-3 h-3', color }: PlayIconProps) {
  return (
    <svg className={className} fill={color ?? 'currentColor'} viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}