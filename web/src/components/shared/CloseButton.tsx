interface CloseButtonProps {
  onClick: () => void
  className?: string
  size?: 'sm' | 'md' | 'lg'
  variant?: 'default' | 'overlay'
}

const sizeClasses = {
  sm: 'w-3 h-3',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
}

export function CloseButton({ onClick, className = '', size = 'md', variant = 'default' }: CloseButtonProps) {
  const baseClasses = variant === 'overlay'
    ? 'bg-accent-error text-white rounded-full flex items-center justify-center hover:bg-accent-error/80 transition-colors'
    : 'hover:text-white transition-colors'

  return (
    <button onClick={onClick} className={`${baseClasses} ${className}`}>
      <svg className={sizeClasses[size]} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  )
}