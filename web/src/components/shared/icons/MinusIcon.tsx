interface MinusIconProps {
  className?: string
}

export function MinusIcon({ className = 'w-3 h-3 text-text-secondary' }: MinusIconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
    </svg>
  )
}
