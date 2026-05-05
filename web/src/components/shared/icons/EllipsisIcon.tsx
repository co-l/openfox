interface EllipsisIconProps {
  className?: string
}

export function EllipsisIcon({ className = 'w-4 h-4' }: EllipsisIconProps) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  )
}
