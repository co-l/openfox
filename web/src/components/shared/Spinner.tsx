interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
}

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  return (
    <div
      className={`animate-spin border-2 border-accent-primary border-t-transparent rounded-full ${sizeClasses[size]} ${className}`}
    />
  )
}

interface SpinnerWithTextProps extends SpinnerProps {
  text?: string
}

export function SpinnerWithText({ text, ...spinnerProps }: SpinnerWithTextProps) {
  return (
    <div className="text-center">
      <Spinner {...spinnerProps} className="mx-auto mb-4" />
      {text && <div className="text-text-secondary">{text}</div>}
    </div>
  )
}
