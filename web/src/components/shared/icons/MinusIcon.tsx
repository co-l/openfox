interface MinusIconProps {
  className?: string
}

export function MinusIcon({ className = 'w-3 h-3 text-accent-primary' }: MinusIconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h16" />
    </svg>
  )
}
