import { Button } from '../shared/Button'
import { useT } from '../../hooks/useT'

export interface RetryPatternEntry {
  field: 'thinking' | 'content' | 'both'
  pattern: string
  action: 'retry'
  active: boolean
}

export interface RetryPatternsValue {
  patterns: RetryPatternEntry[]
  maxRetriesPerTurn: number
}

interface RetryPatternsEditorProps {
  value: RetryPatternsValue
  onChange: (value: RetryPatternsValue) => void
}

export function isValidRegex(pattern: string): boolean {
  if (!pattern || pattern.trim() === '') return false
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

export function RetryPatternsEditor({ value, onChange }: RetryPatternsEditorProps) {
  const t = useT()

  const updatePattern = (index: number, updates: Partial<RetryPatternEntry>) => {
    const newPatterns = value.patterns.map((p, i) => (i === index ? { ...p, ...updates } : p))
    onChange({ ...value, patterns: newPatterns })
  }

  const removePattern = (index: number) => {
    const newPatterns = value.patterns.filter((_, i) => i !== index)
    onChange({ ...value, patterns: newPatterns })
  }

  const addPattern = () => {
    const newEntry: RetryPatternEntry = { field: 'content', pattern: '', action: 'retry', active: true }
    onChange({ ...value, patterns: [...value.patterns, newEntry] })
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium text-text-primary">
          {t({ en: 'Max Retries Per Turn', fr: 'Nouvelles tentatives max par tour' })}
        </label>
        <input
          type="number"
          min={1}
          max={100}
          value={value.maxRetriesPerTurn}
          onChange={(e) => {
            const raw = parseInt(e.target.value, 10)
            const clamped = isNaN(raw) ? 10 : Math.max(1, Math.min(100, raw))
            onChange({ ...value, maxRetriesPerTurn: clamped })
          }}
          className="mt-1 block w-24 px-2 py-1 text-sm bg-bg-secondary border border-border rounded"
        />
      </div>

      {value.patterns.length === 0 ? (
        <p className="text-sm text-text-muted">
          {t({ en: 'No retry patterns configured.', fr: 'Aucun modèle de nouvelle tentative configuré.' })}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-muted border-b border-border">
              <th className="pb-2 pr-2 w-12">{t({ en: 'Active', fr: 'Active' })}</th>
              <th className="pb-2 pr-2">{t({ en: 'Field', fr: 'Champ' })}</th>
              <th className="pb-2 pr-2">{t({ en: 'Pattern', fr: 'Modèle' })}</th>
              <th className="pb-2 pr-2">{t({ en: 'Action', fr: 'Action' })}</th>
              <th className="pb-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {value.patterns.map((p, i) => {
              const valid = isValidRegex(p.pattern)
              const showIndicator = p.pattern.trim() !== ''
              return (
                <tr key={i} className="border-b border-border">
                  <td className="py-2 pr-2">
                    <input
                      type="checkbox"
                      checked={p.active}
                      onChange={() => updatePattern(i, { active: !p.active })}
                      className="accent-accent-primary"
                      aria-label={t({ en: `Toggle pattern ${i + 1}`, fr: `Activer/désactiver le modèle ${i + 1}` })}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <select
                      value={p.field}
                      onChange={(e) => updatePattern(i, { field: e.target.value as RetryPatternEntry['field'] })}
                      className="px-2 py-1 bg-bg-secondary border border-border rounded text-sm"
                    >
                      <option value="content">{t({ en: 'content', fr: 'contenu' })}</option>
                      <option value="thinking">{t({ en: 'thinking', fr: 'réflexion' })}</option>
                      <option value="both">{t({ en: 'both', fr: 'les deux' })}</option>
                    </select>
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={p.pattern}
                        onChange={(e) => updatePattern(i, { pattern: e.target.value })}
                        placeholder={t({ en: 'regex pattern', fr: 'motif regex' })}
                        className="flex-1 px-2 py-1 bg-bg-secondary border border-border rounded text-sm font-mono"
                      />
                      {showIndicator && (
                        <span className={`text-sm ${valid ? 'text-green-500' : 'text-red-500'}`}>
                          {valid ? '✓' : '✗'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-2 text-text-muted">{t({ en: 'retry', fr: 'réessayer' })}</td>
                  <td className="py-2">
                    <button
                      onClick={() => removePattern(i)}
                      title={t({ en: 'Remove pattern', fr: 'Supprimer le modèle' })}
                      className="text-text-muted hover:text-red-500 transition-colors"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <Button variant="secondary" onClick={addPattern}>
        {t({ en: 'Add Pattern', fr: 'Ajouter un modèle' })}
      </Button>
      <p className="text-xs text-text-muted mt-2">
        {t({
          en: 'Empty or invalid patterns are not saved.',
          fr: 'Les modèles vides ou invalides ne sont pas enregistrés.',
        })}
      </p>
    </div>
  )
}
