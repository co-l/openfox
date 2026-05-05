interface ArrowRightIconProps {
  className?: string
}

export function ArrowRightIcon({ className = 'w-3.5 h-3.5' }: ArrowRightIconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
    </svg>
  )
}
