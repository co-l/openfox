interface SpinIconProps {
  className?: string
  size?: 'sm' | 'md'
}

export function SpinIcon({ className = '', size = 'md' }: SpinIconProps) {
  const sizeClass = size === 'sm' ? 'w-4 h-4' : 'w-6 h-6'
  return (
    <svg
      className={`animate-spin ${sizeClass} ${className}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  )
}

export const PlusLgIcon = SpinIcon
export const PlusMdIcon = SpinIcon