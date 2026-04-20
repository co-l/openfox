import { Fragment, useRef, useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from '../shared/Modal'
import { DualSparkline } from '../shared/Sparkline'
import { buildPerformanceChartData, buildResponseLogRows, type ResponseLogRow } from '@shared/stats-view.js'
import type { CallStatsDataPoint, ModelSessionStats, SessionStats } from '@shared/types.js'

interface StatsModalProps {
  isOpen: boolean
  onClose: () => void
  stats: SessionStats
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

function formatRate(value: number): string {
  return `${formatSpeed(value)} t/s`
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
 * Create JSON export data
 */
function createExportData(stats: ModelSessionStats) {
  return {
    exportedAt: new Date().toISOString(),
    providerId: stats.providerId,
    providerName: stats.providerName,
    backend: stats.backend,
    model: stats.model,
    label: stats.label,
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

export function StatsModal({ isOpen, onClose, stats }: StatsModalProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [expandedResponses, setExpandedResponses] = useState<Record<string, boolean>>({})
  const [selectedModelKey, setSelectedModelKey] = useState(() => stats.modelGroups[0]?.key ?? '')

  useEffect(() => {
    if (!stats.modelGroups.some((group) => group.key === selectedModelKey)) {
      setSelectedModelKey(stats.modelGroups[0]?.key ?? '')
    }
  }, [selectedModelKey, stats.modelGroups])

  const currentStats = useMemo(() => (
    stats.modelGroups.find((group) => group.key === selectedModelKey) ?? stats.modelGroups[0]
  ), [selectedModelKey, stats.modelGroups])

  const responseRows = useMemo(() => currentStats ? buildResponseLogRows(currentStats) : [], [currentStats])
  const chartData = useMemo(() => currentStats ? buildPerformanceChartData(currentStats) : { mode: 'responses', xLabel: 'response', prefillLabel: '', generationLabel: '', points: [] }, [currentStats])

  const toggleResponse = useCallback((messageId: string) => {
    setExpandedResponses((current) => ({
      ...current,
      [messageId]: !current[messageId],
    }))
  }, [])

  // Copy JSON to clipboard
  const handleCopyJson = useCallback(() => {
    if (!currentStats) return

    const data = createExportData(currentStats)
    navigator.clipboard.writeText(JSON.stringify(data, null, 2))
      .catch(err => console.error('Failed to copy:', err))
  }, [currentStats])

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
        <section>
          <div className="flex flex-wrap gap-2">
            {stats.modelGroups.map((group) => (
              <button
                key={group.key}
                onClick={() => setSelectedModelKey(group.key)}
                className={`px-3 py-1.5 rounded border text-xs transition-colors ${
                  group.key === currentStats?.key
                    ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                    : 'border-border text-text-muted hover:text-text-primary hover:bg-bg-tertiary/40'
                }`}
                title={group.label}
              >
                {group.label}
              </button>
            ))}
          </div>
        </section>

        {/* Summary Section */}
        {currentStats && (
        <section>
          <h3 className="text-sm font-semibold text-text-secondary mb-3 uppercase tracking-wide">
            Summary
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard label="AI Time" value={formatTime(currentStats.aiTime)} />
            <StatCard label="Total Time" value={formatTime(currentStats.totalTime)} />
            <StatCard label="Tool Time" value={formatTime(currentStats.toolTime)} />
            <StatCard label="Responses" value={currentStats.responseCount.toString()} />
            <StatCard label="LLM Calls" value={currentStats.llmCallCount.toString()} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
            <StatCard 
              label="Prefill Tokens" 
              value={formatTokens(currentStats.prefillTokens)} 
              subValue={`@ ${formatSpeed(currentStats.avgPrefillSpeed)} tok/s`}
            />
            <StatCard 
              label="Gen Tokens" 
              value={formatTokens(currentStats.generationTokens)}
              subValue={`@ ${formatSpeed(currentStats.avgGenerationSpeed)} tok/s`}
            />
            <StatCard 
              label="Avg PP Speed" 
              value={`${formatSpeed(currentStats.avgPrefillSpeed)}`}
              subValue="tok/s"
            />
            <StatCard 
              label="Avg TG Speed" 
              value={`${formatSpeed(currentStats.avgGenerationSpeed)}`}
              subValue="tok/s"
            />
          </div>
        </section>
        )}

        {/* Progression Charts */}
        {currentStats && chartData.points.length > 1 && (
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
        {currentStats && (
        <section>
          <h3 className="text-sm font-semibold text-text-secondary mb-3 uppercase tracking-wide">
            Response Log ({currentStats.responseCount} responses)
          </h3>
          <div className="overflow-y-auto bg-bg-tertiary/30 rounded">
            <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
              <colgroup>
                <col className="w-[7%]" />
                <col className="w-[14%]" />
                <col className="w-[10%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
                <col className="w-[11%]" />
                <col className="w-[2%]" />
              </colgroup>
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-text-muted/80">
                  <th className="px-3 py-2 text-center font-medium">#</th>
                  <th className="px-2 py-2 text-center font-medium">At</th>
                  <th className="px-2 py-2 text-center font-medium">Time</th>
                  <th className="px-2 py-2 text-center font-medium">Context</th>
                  <th className="px-2 py-2 text-center font-medium">PP t/s</th>
                  <th className="px-2 py-2 text-center font-medium">TG t/s</th>
                  <th className="px-2 py-2 text-center font-medium">Calls</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {responseRows.map((row, i) => (
                  <Fragment key={row.messageId}>
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
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        )}
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

  return (
    <tr
      onClick={onToggle}
      className={`${index % 2 === 0 ? 'bg-bg-tertiary/20' : ''} ${onToggle ? 'cursor-pointer hover:bg-bg-tertiary/35 transition-colors' : ''}`}
    >
      <td className="px-3 py-2 text-center text-text-muted align-middle">{row.responseIndex}</td>
      <td className="px-2 py-2 text-center text-text-muted font-mono align-middle whitespace-nowrap">{formatTimestamp(row.timestamp)}</td>
      <td className="px-2 py-2 text-center text-text-muted align-middle whitespace-nowrap">{row.totalTime.toFixed(1)}s</td>
      <td className="px-2 py-2 text-center text-text-primary font-mono align-middle whitespace-nowrap">{contextSummary.replace(/ ctx$/, '')}</td>
      <td className="px-2 py-2 text-center text-text-primary font-mono align-middle whitespace-nowrap">{formatRate(row.prefillSpeed)}</td>
      <td className="px-2 py-2 text-center text-text-primary font-mono align-middle whitespace-nowrap">{formatRate(row.generationSpeed)}</td>
      <td className="px-2 py-2 text-center text-text-muted font-mono align-middle whitespace-nowrap">{row.callCount}</td>
      <td className="px-2 py-2 text-center text-text-muted align-middle whitespace-nowrap">{row.isExpandable ? (isExpanded ? 'v' : '>') : ''}</td>
    </tr>
  )
}

function CallDataPointRow({
  dataPoint,
  index,
}: {
  dataPoint: CallStatsDataPoint
  index: number
}) {
  const hasParams = dataPoint.temperature !== undefined || dataPoint.topP !== undefined || dataPoint.topK !== undefined || dataPoint.maxTokens !== undefined

  return (
    <>
      <tr className={`${index % 2 === 0 ? 'bg-bg-tertiary/10' : 'bg-bg-tertiary/5'}`}>
        <td className="px-3 py-2 pl-6 text-center text-text-muted align-middle border-l border-border/60">c{dataPoint.callIndex}</td>
        <td className="px-2 py-2 text-center text-text-muted font-mono align-middle whitespace-nowrap">{formatTimestamp(dataPoint.timestamp)}</td>
        <td className="px-2 py-2 text-center text-text-muted align-middle whitespace-nowrap">{dataPoint.totalTime.toFixed(1)}s</td>
        <td className="px-2 py-2 text-center text-text-primary font-mono align-middle whitespace-nowrap">{formatTokens(dataPoint.promptTokens)}</td>
        <td className="px-2 py-2 text-center text-text-primary font-mono align-middle whitespace-nowrap">{formatRate(dataPoint.prefillSpeed)}</td>
        <td className="px-2 py-2 text-center text-text-primary font-mono align-middle whitespace-nowrap">{formatRate(dataPoint.generationSpeed)}</td>
        <td className="px-2 py-2 text-center text-text-muted font-mono align-middle whitespace-nowrap">{dataPoint.callIndex}</td>
        <td className="px-2 py-2" />
      </tr>
      {hasParams && (
        <tr className={`${index % 2 === 0 ? 'bg-bg-tertiary/5' : 'bg-bg-tertiary/[2.5%]'}`}>
          <td colSpan={8} className="px-6 py-1.5 border-l border-border/60">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted">
              {dataPoint.temperature !== undefined && <span>temp: {dataPoint.temperature.toFixed(2)}</span>}
              {dataPoint.topP !== undefined && <span>topP: {dataPoint.topP.toFixed(2)}</span>}
              {dataPoint.topK !== undefined && <span>topK: {dataPoint.topK}</span>}
              {dataPoint.maxTokens !== undefined && <span>maxTok: {dataPoint.maxTokens}</span>}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
