import { TestFieldRow } from './TestFieldRow'

export function TestResultBlock({
  testKey,
  testResults,
  thinkingField,
  onSeeRaw,
}: {
  testKey: string
  testResults: Record<string, { result?: string; message?: Record<string, unknown>; error?: string; loading?: boolean }>
  thinkingField: string
  onSeeRaw: (raw: string) => void
}) {
  const result = testResults[testKey]
  if (!result?.result) return null

  const msg = result.message
  const resolvedField = thinkingField
    ? thinkingField
    : msg?.['reasoning']
      ? 'reasoning'
      : msg?.['reasoning_content']
        ? 'reasoning_content'
        : msg?.['thinking']
          ? 'thinking'
          : undefined

  return (
    <div className="flex-1 space-y-1">
      {result.message && (
        <>
          <TestFieldRow message={result.message} field="content" label="content" />
          {resolvedField && <TestFieldRow message={result.message} field={resolvedField} label={resolvedField} />}
        </>
      )}
      <button onClick={() => onSeeRaw(result.result ?? '')} className="text-xs text-accent-primary hover:underline">
        See raw output
      </button>
    </div>
  )
}
