import { useT } from '../../hooks/useT'

export function QueryParamsInput({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  const t = useT()
  return (
    <div>
      <label className="text-xs text-text-secondary block mb-1">
        {t({ en: 'Query params', fr: 'Paramètres de requête' })}{' '}
        <span className="text-text-muted">{t({ en: '(optional JSON)', fr: '(JSON facultatif)' })}</span>
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
