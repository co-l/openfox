interface BellIconProps {
  className?: string
}

export function BellIcon({ className = 'w-5 h-5' }: BellIconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
