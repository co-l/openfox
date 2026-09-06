interface MoveTargetArrowIconProps {
  className?: string
}

export function MoveTargetLeftIcon({ className = 'w-3.5 h-3.5' }: MoveTargetArrowIconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H6m0 0l5-5m-5 5l5 5" />
    </svg>
  )
}
