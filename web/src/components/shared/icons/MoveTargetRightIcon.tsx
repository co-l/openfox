interface MoveTargetArrowIconProps {
  className?: string
}

export function MoveTargetRightIcon({ className = 'w-3.5 h-3.5' }: MoveTargetArrowIconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h14m0 0l-5-5m5 5l-5 5" />
    </svg>
  )
}
