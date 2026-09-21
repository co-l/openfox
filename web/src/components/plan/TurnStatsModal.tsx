import { Modal } from '../shared/SelfContainedModal'
import { useT } from '../../hooks/useT'
import type { TurnStats } from '../../lib/types'
import { useAgents } from '../../hooks/useAgents'
import { formatTime } from '../../lib/format-stats'

interface TurnStatsModalProps {
  stats: TurnStats
  onClose: () => void
}

export function TurnStatsModal({ stats: s, onClose }: TurnStatsModalProps) {
  const t = useT()
  const { agents } = useAgents()
  const agentInfo = agents.find((a) => a.id === s.mode)
  const modeName = agentInfo?.name ?? s.mode
  const modelLabel = s.reasoningEffort ? `${s.model}:${s.reasoningEffort}` : s.model

  return (
    <Modal isOpen={true} onClose={onClose} title={t({ en: 'Turn Stats', fr: 'Statistiques du tour' })} size="md">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <p className="text-xs text-text-muted">
            {modelLabel} · {modeName}
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label={t({ en: 'Total Time', fr: 'Temps total' })} value={formatTime(s.totalTime)} />
          <StatCard label={t({ en: 'Prefill', fr: 'Préremplissage' })} value={formatTokens(s.prefillTokens)} />
          <StatCard label={t({ en: 'Generated', fr: 'Généré' })} value={formatTokens(s.generationTokens)} />
          <StatCard label={t({ en: 'LLM Calls', fr: 'Appels LLM' })} value={String(s.llmCalls?.length ?? 1)} />
        </div>

        {s.llmCalls && s.llmCalls.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-text-secondary mb-2">{t({ en: 'LLM Calls', fr: 'Appels LLM' })}</h4>
            {s.llmCalls.map((call, i) => (
              <div key={i} className="bg-bg-tertiary/30 rounded p-3 mb-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-text-muted">
                    {t({ en: 'Call {{count}}', fr: 'Appel {{count}}' }, { count: i + 1 })}
                  </span>
                  <span className="text-xs text-text-muted">
                    {`${call.ttft.toFixed(2)}s TTFT · ${call.completionTime.toFixed(2)}s gen`}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-text-muted">{t({ en: 'Tokens:', fr: 'Jetons :' })}</span>{' '}
                    <span className="text-text-primary">{`${call.promptTokens} → ${call.completionTokens}`}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-2 gap-y-1">
                    {call.temperature !== undefined && <Tag label="temp" value={call.temperature.toFixed(2)} />}
                    {call.topP !== undefined && <Tag label="topP" value={call.topP.toFixed(2)} />}
                    {call.topK !== undefined && <Tag label="topK" value={String(call.topK)} />}
                    {call.maxTokens !== undefined && <Tag label="maxTok" value={String(call.maxTokens)} />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

function formatTokens(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-tertiary/50 rounded p-3">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="text-lg font-semibold text-text-primary">{value}</div>
    </div>
  )
}

function Tag({ label, value }: { label: string; value: string }) {
  return (
    <span className="bg-bg-tertiary px-1.5 py-0.5 rounded text-text-primary">
      <span className="text-text-muted">{label}:</span> {value}
    </span>
  )
}
