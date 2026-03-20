import { useRef, useCallback, useMemo, useState } from 'react'
import { Modal } from '../shared/Modal'
import { DualSparkline } from '../shared/Sparkline'
import { buildPerformanceChartData, buildResponseLogRows, type ResponseLogRow } from '../../../../src/shared/stats-view.js'
import type { CallStatsDataPoint, SessionStats } from '../../../../src/shared/types.js'

interface StatsModalProps {
  isOpen: boolean
  onClose: () => void
  stats: SessionStats
  model?: string
}

/**
 * Format seconds to human-readable time
 */
function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs.toFixed(0)}s`
}

/**
 * Format token count with k/M suffix
 */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toString()
}

/**
 * Format speed with k suffix
 */
function formatSpeed(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(1)
}

function formatContextRange(tokens: number[]): string {
  if (tokens.length === 0) return '0 ctx'

  const minTokens = Math.min(...tokens)
  const maxTokens = Math.max(...tokens)

  if (minTokens === maxTokens) {
    return `${formatTokens(minTokens)} ctx`
  }

  return `${formatTokens(minTokens)}-${formatTokens(maxTokens)} ctx`
}

function formatRate(value: number, label: 'pp' | 'tg'): string {
  return `${formatSpeed(value)} ${label} t/s`
}

/**
 * Format timestamp to time only (HH:MM:SS)
 */
function formatTimestamp(ts: string): string {
  try {
    const date = new Date(ts)
    return date.toLocaleTimeString('en-US', { hour12: false })
  } catch {
    return ts
  }
}

/**
 * Get mode badge color
 */
function getModeColor(mode: string): string {
  switch (mode) {
    case 'planner': return 'bg-accent-primary/20 text-accent-primary'
    case 'builder': return 'bg-accent-success/20 text-accent-success'
    case 'verifier': return 'bg-accent-warning/20 text-accent-warning'
    default: return 'bg-bg-tertiary text-text-muted'
  }
}

/**
 * Create JSON export data
 */
function createExportData(stats: SessionStats, model?: string) {
  return {
    exportedAt: new Date().toISOString(),
    model: model ?? 'unknown',
    summary: {
      totalTime: stats.totalTime,
      aiTime: stats.aiTime,
      toolTime: stats.toolTime,
      prefillTokens: stats.prefillTokens,
      generationTokens: stats.generationTokens,
      avgPrefillSpeed: stats.avgPrefillSpeed,
      avgGenerationSpeed: stats.avgGenerationSpeed,
      responseCount: stats.responseCount,
      llmCallCount: stats.llmCallCount,
    },
    responses: stats.dataPoints.map(dp => ({
      responseIndex: dp.responseIndex,
      timestamp: dp.timestamp,
      mode: dp.mode,
      prefillTokens: dp.prefillTokens,
      generationTokens: dp.generationTokens,
      prefillSpeed: dp.prefillSpeed,
      generationSpeed: dp.generationSpeed,
      totalTime: dp.totalTime,
      aiTime: dp.aiTime,
      toolTime: dp.toolTime,
    })),
    llmCalls: stats.callDataPoints.map(dp => ({
      sessionCallIndex: dp.sessionCallIndex,
      responseIndex: dp.responseIndex,
      callIndex: dp.callIndex,
      timestamp: dp.timestamp,
      mode: dp.mode,
      promptTokens: dp.promptTokens,
      completionTokens: dp.completionTokens,
      ttft: dp.ttft,
      completionTime: dp.completionTime,
      prefillSpeed: dp.prefillSpeed,
      generationSpeed: dp.generationSpeed,
      totalTime: dp.totalTime,
    })),
  }
}

export function StatsModal({ isOpen, onClose, stats, model }: StatsModalProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [expandedResponses, setExpandedResponses] = useState<Record<string, boolean>>({})
  const responseRows = useMemo(() => buildResponseLogRows(stats), [stats])
  const chartData = useMemo(() => buildPerformanceChartData(stats), [stats])

  const toggleResponse = useCallback((messageId: string) => {
    setExpandedResponses((current) => ({
      ...current,
      [messageId]: !current[messageId],
    }))
  }, [])

  // Copy JSON to clipboard
  const handleCopyJson = useCallback(() => {
    const data = createExportData(stats, model)
    navigator.clipboard.writeText(JSON.stringify(data, null, 2))
      .catch(err => console.error('Failed to copy:', err))
  }, [stats, model])

  // Export PNG (requires html2canvas)
  const handleExportPng = useCallback(async () => {
    if (!contentRef.current) return
    
    try {
      // Dynamic import to avoid bundling if not used
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(contentRef.current, {
        backgroundColor: '#1a1a1a',  // bg-bg-primary
        scale: 2,  // Higher resolution
      })
      
      // Download
      const link = document.createElement('a')
      link.download = `openfox-stats-${new Date().toISOString().slice(0, 10)}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } catch (err) {
      console.error('Failed to export PNG:', err)
      // Fallback: show error or just copy JSON
      handleCopyJson()
    }
  }, [handleCopyJson])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Session Stats" size="lg">
      <div ref={contentRef} className="space-y-6">
        {/* Summary Section */}
        <section>
          <h3 className="text-sm font-semibold text-text-secondary mb-3 uppercase tracking-wide">
            Summary
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard label="AI Time" value={formatTime(stats.aiTime)} />
            <StatCard label="Total Time" value={formatTime(stats.totalTime)} />
            <StatCard label="Tool Time" value={formatTime(stats.toolTime)} />
            <StatCard label="Responses" value={stats.responseCount.toString()} />
            <StatCard label="LLM Calls" value={stats.llmCallCount.toString()} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
            <StatCard 
              label="Prefill Tokens" 
              value={formatTokens(stats.prefillTokens)} 
              subValue={`@ ${formatSpeed(stats.avgPrefillSpeed)} tok/s`}
            />
            <StatCard 
              label="Gen Tokens" 
              value={formatTokens(stats.generationTokens)}
              subValue={`@ ${formatSpeed(stats.avgGenerationSpeed)} tok/s`}
            />
            <StatCard 
              label="Avg PP Speed" 
              value={`${formatSpeed(stats.avgPrefillSpeed)}`}
              subValue="tok/s"
            />
            <StatCard 
              label="Avg TG Speed" 
              value={`${formatSpeed(stats.avgGenerationSpeed)}`}
              subValue="tok/s"
            />
          </div>
        </section>

        {/* Progression Charts */}
        {chartData.points.length > 1 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                Performance Progression
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyJson}
                  className="px-2 py-1 text-xs text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
                >
                  Copy JSON
                </button>
                <button
                  onClick={handleExportPng}
                  className="px-2 py-1 text-xs text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
                >
                  Save PNG
                </button>
              </div>
            </div>
            <div className="bg-bg-tertiary/50 rounded p-4">
              <DualSparkline
                data={chartData.points}
                width={50}
                prefillLabel={chartData.prefillLabel}
                generationLabel={chartData.generationLabel}
                xLabel={chartData.xLabel}
              />
            </div>
          </section>
        )}

        {/* Response Log */}
        <section>
          <h3 className="text-sm font-semibold text-text-secondary mb-3 uppercase tracking-wide">
            Response Log ({stats.dataPoints.length} responses)
          </h3>
          <div className="max-h-60 overflow-y-auto bg-bg-tertiary/30 rounded">
            {responseRows.map((row, i) => (
              <div key={row.messageId}>
                <ResponseRow
                  row={row}
                  index={i}
                  isExpanded={expandedResponses[row.messageId] ?? false}
                  onToggle={row.isExpandable ? () => toggleResponse(row.messageId) : undefined}
                />
                {(expandedResponses[row.messageId] ?? false) && row.calls.map((call, callIndex) => (
                  <CallDataPointRow
                    key={`${call.messageId}-${call.callIndex}`}
                    dataPoint={call}
                    index={callIndex}
                  />
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  )
}

/**
 * Summary stat card component
 */
function StatCard({ 
  label, 
  value, 
  subValue 
}: { 
  label: string
  value: string
  subValue?: string 
}) {
  return (
    <div className="bg-bg-tertiary/50 rounded p-3">
      <div className="text-text-muted text-xs mb-1">{label}</div>
      <div className="text-text-primary text-lg font-semibold">{value}</div>
      {subValue && <div className="text-text-muted text-xs">{subValue}</div>}
    </div>
  )
}

/**
 * Single row in the response log
 */
function ResponseRow({
  row,
  index,
  isExpanded,
  onToggle,
}: {
  row: ResponseLogRow
  index: number
  isExpanded: boolean
  onToggle?: () => void
}) {
  const contextSummary = row.calls.length > 0
    ? formatContextRange(row.calls.map((call) => call.promptTokens))
    : `${formatTokens(row.prefillTokens)} ctx`

  const content = (
    <div className="grid grid-cols-[2.75rem_5.75rem_5.5rem_4.75rem_8rem_4.5rem_7.5rem_7.5rem_1.5rem] items-center gap-3 w-full">
      <span className="text-text-muted w-6 text-right">#{row.responseIndex}</span>
      <span className="text-text-muted w-20 font-mono">
        {formatTimestamp(row.timestamp)}
      </span>
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getModeColor(row.mode)}`}>
        {row.mode}
      </span>
      <span className="text-text-muted font-mono text-right">
        {row.callCount} {row.callCount === 1 ? 'call' : 'calls'}
      </span>
      <span className="text-text-secondary w-16 text-right font-mono">
        {contextSummary}
      </span>
      <span className="text-text-secondary w-12 text-right">
        {row.totalTime.toFixed(1)}s
      </span>
      <span className="text-text-muted text-right font-mono">
        {formatRate(row.prefillSpeed, 'pp')}
      </span>
      <span className="text-text-muted text-right font-mono">
        {formatRate(row.generationSpeed, 'tg')}
      </span>
      <span className="text-text-muted w-4 text-center">
        {row.isExpandable ? (isExpanded ? 'v' : '>') : ''}
      </span>
    </div>
  )

  return (
    <div className={`flex items-center gap-3 px-3 py-2 text-xs ${
      index % 2 === 0 ? 'bg-bg-tertiary/20' : ''
    }`}>
      {onToggle ? (
        <button
          onClick={onToggle}
          className="flex items-center gap-3 w-full text-left hover:text-text-primary transition-colors"
        >
          {content}
        </button>
      ) : (
        <div className="flex items-center gap-3 w-full">
          {content}
        </div>
      )}
    </div>
  )
}

function CallDataPointRow({
  dataPoint,
  index,
}: {
  dataPoint: CallStatsDataPoint
  index: number
}) {
  return (
    <div className={`relative px-3 py-2 text-xs ${
      index % 2 === 0 ? 'bg-bg-tertiary/10' : 'bg-bg-tertiary/5'
    }`}>
      <div className="absolute left-6 top-0 bottom-0 w-px bg-border/60" />
      <div className="grid grid-cols-[2.75rem_5.75rem_5.5rem_4.75rem_8rem_4.5rem_7.5rem_7.5rem_1.5rem] items-center gap-3 w-full relative">
        <span className="text-text-muted w-6 text-right">c{dataPoint.callIndex}</span>
        <span className="text-text-muted w-20 font-mono">
          {formatTimestamp(dataPoint.timestamp)}
        </span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getModeColor(dataPoint.mode)}`}>
          {dataPoint.mode}
        </span>
        <span className="text-text-muted font-mono text-right">
          r{dataPoint.responseIndex}.c{dataPoint.callIndex}
        </span>
        <span className="text-text-secondary font-mono text-right">
          {formatTokens(dataPoint.promptTokens)} ctx
        </span>
        <span className="text-text-secondary text-right">
          {dataPoint.totalTime.toFixed(1)}s
        </span>
        <span className="text-text-muted text-right font-mono">
          {formatRate(dataPoint.prefillSpeed, 'pp')}
        </span>
        <span className="text-text-muted text-right font-mono">
          {formatRate(dataPoint.generationSpeed, 'tg')}
        </span>
        <span />
      </div>
    </div>
  )
}
