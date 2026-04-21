interface SpinIconProps {
  className?: string
}

export function SpinIcon({ className = 'w-3 h-3 text-blue-400 animate-spin flex-shrink-0' }: SpinIconProps) {
  return (
    <svg
      aria-label="Session running"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
    >
      <title>Running</title>
      <circle className="opacity-30" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}