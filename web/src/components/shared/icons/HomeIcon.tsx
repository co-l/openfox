interface HomeIconProps {
  className?: string
}

export function HomeIcon({ className = 'w-4 h-4' }: HomeIconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 10.5L12 3l9 7.5M5 9.5V20a1 1 0 001 1h4.5v-6h3v6H18a1 1 0 001-1V9.5"
      />
    </svg>
  )
}
