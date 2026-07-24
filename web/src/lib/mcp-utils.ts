export function mcpStatusColor(status: string): string {
  switch (status) {
    case 'connected':
      return 'text-accent-success'
    case 'error':
      return 'text-accent-error'
    case 'disabled':
      return 'text-text-muted'
    default:
      return 'text-text-muted'
  }
}

export function mcpStatusDot(status: string): string {
  switch (status) {
    case 'connected':
      return '●'
    case 'error':
      return '✕'
    default:
      return '○'
  }
}

export function formatTokens(n: number): string {
  if (n >= 1000) return `~${(n / 1000).toFixed(1)}K`
  return `~${n}`
}
