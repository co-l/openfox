interface ColumnsIconProps {
  className?: string
}

export function ColumnsIcon({ className = 'w-4 h-4' }: ColumnsIconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="3.5" y="4" width="7" height="16" rx="1.5" strokeWidth={1.8} />
      <rect x="13.5" y="4" width="7" height="16" rx="1.5" strokeWidth={1.8} />
    </svg>
  )
}
