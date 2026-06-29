import { TestResultBlock } from './TestResultBlock'

export function ExtraKwargsBlock({
  kwargs,
  onChange,
  mode,
  modelId,
  testResults,
  thinkingField,
  onSeeRaw,
  onTest,
}: {
  kwargs: string
  onChange: (v: string) => void
  mode: 'thinking' | 'non-thinking'
  modelId: string
  testResults: Record<string, { loading: boolean; result?: string; message?: Record<string, unknown>; error?: string }>
  thinkingField: string
  onSeeRaw: (raw: string) => void
  onTest: () => void
}) {
  const testKey = modelId + '-' + mode
  return (
    <>
      <div>
        <label className="text-xs text-text-secondary block mb-1">Extra kwargs</label>
        <input
          type="text"
          value={kwargs}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-2 py-1 bg-bg-tertiary border border-border rounded text-xs text-text-primary font-mono"
        />
      </div>
      <div className="flex gap-2 items-start">
        <button
          onClick={onTest}
          disabled={testResults[testKey]?.loading}
          className="px-2 py-1 bg-bg-tertiary border border-border rounded text-xs text-text-muted hover:text-text-secondary disabled:opacity-50"
        >
          {testResults[testKey]?.loading ? 'Testing...' : 'Test'}
        </button>
        {testResults[testKey]?.result && (
          <TestResultBlock
            testKey={testKey}
            testResults={testResults}
            thinkingField={thinkingField}
            onSeeRaw={onSeeRaw}
          />
        )}
        {testResults[testKey]?.error && <span className="text-xs text-red-500">{testResults[testKey]?.error}</span>}
      </div>
    </>
  )
}
