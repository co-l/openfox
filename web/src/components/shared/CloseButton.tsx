import { IconButton } from './IconButton'

interface CloseButtonProps {
  onClick: () => void
  className?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  variant?: 'default' | 'overlay' | 'sidebar' | 'modal'
}

const sizeClasses = {
  sm: 'w-3 h-3',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
  xl: 'w-6 h-6',
}

const CLOSE_PATH = 'M6 18L18 6M6 6l12 12'

export function CloseButton({ onClick, className = '', size = 'md', variant = 'default' }: CloseButtonProps) {
  const baseClasses =
    variant === 'overlay'
      ? 'bg-accent-error text-white rounded-full flex items-center justify-center hover:bg-accent-error/80 transition-colors'
      : variant === 'sidebar'
        ? 'flex-shrink-0 p-2.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors'
        : variant === 'modal'
          ? 'text-text-muted hover:text-text-primary transition-colors'
          : 'hover:text-white transition-colors'

  return (
    <IconButton
      onClick={onClick}
      icon={CLOSE_PATH}
      iconSize={sizeClasses[size]}
      className={`${baseClasses} ${className}`}
      title="Close"
    />
  )
}
