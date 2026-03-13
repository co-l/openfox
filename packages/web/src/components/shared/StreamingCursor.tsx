interface StreamingCursorProps {
  variant?: 'block' | 'pipe'
}

export function StreamingCursor({ variant = 'block' }: StreamingCursorProps) {
  if (variant === 'pipe') {
    return <span className="animate-pulse text-accent-primary">|</span>
  }
  
  return <span className="inline-block w-2 h-4 bg-accent-primary animate-pulse" />
}
