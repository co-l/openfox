import { Modal } from '../shared/SelfContainedModal'
import type { TurnStats } from '../../lib/types'

interface TurnStatsModalProps {
  stats: TurnStats
  onClose: () => void
}

export function TurnStatsModal({ stats: s, onClose }: TurnStatsModalProps) {
  return (
    <Modal isOpen={true} onClose={onClose} title="Turn Stats" size="md">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <p className="text-xs text-text-muted">
            {s.model} · {s.mode}
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total Time" value={`${s.totalTime.toFixed(1)}s`} />
          <StatCard
            label="Prefill"
            value={s.prefillTokens >= 1000 ? `${(s.prefillTokens / 1000).toFixed(1)}k` : String(s.prefillTokens)}
          />
          <StatCard
            label="Generated"
            value={
              s.generationTokens >= 1000 ? `${(s.generationTokens / 1000).toFixed(1)}k` : String(s.generationTokens)
            }
          />
          <StatCard label="LLM Calls" value={String(s.llmCalls?.length ?? 1)} />
        </div>

        {s.llmCalls && s.llmCalls.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-text-secondary mb-2">LLM Calls</h4>
            {s.llmCalls.map((call, i) => (
              <div key={i} className="bg-bg-tertiary/30 rounded p-3 mb-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-text-muted">Call {i + 1}</span>
                  <span className="text-xs text-text-muted">
                    {call.ttft.toFixed(2)}s TTFT · {call.completionTime.toFixed(2)}s gen
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-text-muted">Tokens:</span>{' '}
                    <span className="text-text-primary">
                      {call.promptTokens} → {call.completionTokens}
                    </span>
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
