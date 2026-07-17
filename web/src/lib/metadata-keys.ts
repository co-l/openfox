const metadataKeyLabels: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, {
  criteria: 'Acceptance Criteria',
  review_findings: 'Review Findings',
  todos: 'Tasks',
})

export { metadataKeyLabels }

const metadataKeyLabelsLower: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, {
  criteria: 'criteria',
  review_findings: 'review findings',
  todos: 'tasks',
})

export function formatMetadataKeyLabel(key: string): string {
  return Object.hasOwn(metadataKeyLabels, key)
    ? (metadataKeyLabels[key] as string)
    : key
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
}

export function formatMetadataKeyLabelLower(key: string): string {
  return Object.hasOwn(metadataKeyLabelsLower, key)
    ? (metadataKeyLabelsLower[key] as string)
    : key.replace(/_/g, ' ')
}
