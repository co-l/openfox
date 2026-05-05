interface OpenExternalIconProps {
  className?: string
}

export function OpenExternalIcon({ className = 'w-4 h-4' }: OpenExternalIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6.5 3.5H3a1 1 0 0 0-1 1V13a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1V9.5" />
      <path d="M9.5 2h4.5v4.5" />
      <path d="M14 2L7.5 8.5" />
    </svg>
  )
}
