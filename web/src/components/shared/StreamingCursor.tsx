interface StreamingCursorProps {
  variant?: 'block' | 'pipe'
}

export function StreamingCursor({ variant = 'block' }: StreamingCursorProps) {
  if (variant === 'pipe') {
    return <span className="animate-pulse text-accent-primary text-sm">|</span>
  }

  return <span className="inline-block w-1.5 h-3 bg-accent-primary animate-pulse" />
}
