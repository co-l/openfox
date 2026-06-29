export function QueryParamsInput({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs text-text-secondary block mb-1">
        Query params <span className="text-text-muted">(optional JSON)</span>
      </label>
      <input
        type="text"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1 bg-bg-tertiary border border-border rounded text-xs text-text-primary font-mono"
      />
    </div>
  )
}
