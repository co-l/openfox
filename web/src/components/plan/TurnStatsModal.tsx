import { Modal } from '../shared/Modal'

interface TurnStatsModalProps {
  stats: {
    model: string
    mode: string
    totalTime: number
    prefillTokens: number
    generationTokens: number
    llmCalls?: Array<{
      temperature?: number
      topP?: number
      topK?: number
      maxTokens?: number
      promptTokens: number
      completionTokens: number
      ttft: number
      completionTime: number
    }>
  }
  onClose: () => void
}

export function TurnStatsModal({ stats: s, onClose }: TurnStatsModalProps) {
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[60]" onClick={onClose} />
      <Modal isOpen={true} onClose={onClose} title="Turn Stats" size="md">
        <div className="space-y-4" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-3">
            <p className="text-xs text-text-muted">{s.model} · {s.mode}</p>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-bg-tertiary/50 rounded p-3">
              <div className="text-xs text-text-muted">Total Time</div>
              <div className="text-lg font-semibold text-text-primary">{s.totalTime.toFixed(1)}s</div>
            </div>
            <div className="bg-bg-tertiary/50 rounded p-3">
              <div className="text-xs text-text-muted">Prefill</div>
              <div className="text-lg font-semibold text-text-primary">{s.prefillTokens >= 1000 ? `${(s.prefillTokens / 1000).toFixed(1)}k` : s.prefillTokens}</div>
            </div>
            <div className="bg-bg-tertiary/50 rounded p-3">
              <div className="text-xs text-text-muted">Generated</div>
              <div className="text-lg font-semibold text-text-primary">{s.generationTokens >= 1000 ? `${(s.generationTokens / 1000).toFixed(1)}k` : s.generationTokens}</div>
            </div>
            <div className="bg-bg-tertiary/50 rounded p-3">
              <div className="text-xs text-text-muted">LLM Calls</div>
              <div className="text-lg font-semibold text-text-primary">{s.llmCalls?.length ?? 1}</div>
            </div>
          </div>

          {/* LLM Calls with Parameters */}
          {s.llmCalls && s.llmCalls.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-text-secondary mb-2">LLM Calls</h4>
              {s.llmCalls.map((call, i) => (
                <div key={i} className="bg-bg-tertiary/30 rounded p-3 mb-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-text-muted">Call {i + 1}</span>
                    <span className="text-xs text-text-muted">{call.ttft.toFixed(2)}s TTFT · {call.completionTime.toFixed(2)}s gen</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-text-muted">Tokens:</span>{' '}
                      <span className="text-text-primary">{call.promptTokens} → {call.completionTokens}</span>
                    </div>
                    {(call.temperature !== undefined || call.topP !== undefined || call.topK !== undefined || call.maxTokens !== undefined) && (
                      <div className="flex flex-wrap gap-x-2 gap-y-1">
                        {call.temperature !== undefined && (
                          <span className="bg-bg-tertiary px-1.5 py-0.5 rounded">
                            <span className="text-text-muted">temp:</span>{' '}
                            <span className="text-text-primary">{call.temperature.toFixed(2)}</span>
                          </span>
                        )}
                        {call.topP !== undefined && (
                          <span className="bg-bg-tertiary px-1.5 py-0.5 rounded">
                            <span className="text-text-muted">topP:</span>{' '}
                            <span className="text-text-primary">{call.topP.toFixed(2)}</span>
                          </span>
                        )}
                        {call.topK !== undefined && (
                          <span className="bg-bg-tertiary px-1.5 py-0.5 rounded">
                            <span className="text-text-muted">topK:</span>{' '}
                            <span className="text-text-primary">{call.topK}</span>
                          </span>
                        )}
                        {call.maxTokens !== undefined && (
                          <span className="bg-bg-tertiary px-1.5 py-0.5 rounded">
                            <span className="text-text-muted">maxTok:</span>{' '}
                            <span className="text-text-primary">{call.maxTokens}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}