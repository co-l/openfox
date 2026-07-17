export const metadataKeyLabels: Record<string, string> = {
  criteria: 'Acceptance Criteria',
  review_findings: 'Review Findings',
  todos: 'Tasks',
}

const metadataKeyLabelsLower: Record<string, string> = {
  criteria: 'criteria',
  review_findings: 'review findings',
  todos: 'tasks',
}

export function formatMetadataKeyLabel(key: string): string {
  return (
    metadataKeyLabels[key] ??
    key
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  )
}

export function formatMetadataKeyLabelLower(key: string): string {
  return metadataKeyLabelsLower[key] ?? key.replace(/_/g, ' ')
}
