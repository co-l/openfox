interface QuotaIconProps {
  className?: string
}

export function QuotaIcon({ className = 'w-4 h-4' }: QuotaIconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 13.5V11a9 9 0 0118 0v2.5M3 13.5h2.5M21 13.5h-2.5M3 13.5c0 1.38.56 2.63 1.46 3.54M21 13.5c0 1.38-.56 2.63-1.46 3.54M7.5 13.5v3a4.5 4.5 0 009 0v-3"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 7v6" />
    </svg>
  )
}
