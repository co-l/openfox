interface CheckIconProps {
  className?: string
}

export function CheckIcon({ className = 'w-3.5 h-3.5 text-text-muted' }: CheckIconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  )
}
