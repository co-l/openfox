export function TestFieldRow({
  message,
  field,
  label,
}: {
  message: Record<string, unknown> | null | undefined
  field: string
  label: string
}) {
  const value = message?.[field]
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={value != null ? 'text-accent-success' : 'text-red-500'}>{value != null ? '✓' : '✗'}</span>
      <span className="text-text-secondary">{label}:</span>
      <span className="text-text-primary font-mono truncate max-w-[200px]">{JSON.stringify(value ?? 'undefined')}</span>
    </div>
  )
}
