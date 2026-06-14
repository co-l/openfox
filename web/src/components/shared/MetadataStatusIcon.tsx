import { memo } from 'react'

const statusConfig: Record<string, { icon: string; color: string }> = {
  passed: { icon: '✓', color: 'text-accent-success' },
  completed: { icon: '◉', color: 'text-purple-400' },
  failed: { icon: '✗', color: 'text-accent-error' },
  resolved: { icon: '✓', color: 'text-accent-success' },
  dismissed: { icon: '–', color: 'text-text-muted' },
  open: { icon: '○', color: 'text-accent-warning' },
  pending: { icon: '○', color: 'text-text-muted' },
  in_progress: { icon: '◌', color: 'text-accent-warning' },
}

export const statusOrder = ['open', 'in_progress', 'pending', 'completed', 'resolved', 'dismissed', 'passed', 'failed']

export function getStatusConfig(status: string): { icon: string; color: string } {
  return statusConfig[status] ?? { icon: '○', color: 'text-text-muted' }
}

export function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement('textarea')
  textarea.innerHTML = text
  return textarea.value
}

interface MetadataStatusIconProps {
  status: string
  className?: string
}

export const MetadataStatusIcon = memo(function MetadataStatusIcon({
  status,
  className = 'text-xs leading-tight flex-shrink-0',
}: MetadataStatusIconProps) {
  const { icon, color } = getStatusConfig(status)
  return <span className={`${color} ${className}`}>{icon}</span>
})
