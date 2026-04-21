interface ArrowLeftIconProps {
  className?: string
}

export function ArrowLeftIcon({ className = 'w-5 h-5' }: ArrowLeftIconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
  )
}