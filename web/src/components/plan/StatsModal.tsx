import { useRef, useCallback } from 'react'
import { Modal } from '../shared/Modal'
import { DualSparkline } from '../shared/Sparkline'
import type { SessionStats, StatsDataPoint } from '../../../src/shared/types.js'

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
      messageCount: stats.messageCount,
    },
    dataPoints: stats.dataPoints.map(dp => ({
      timestamp: dp.timestamp,
      mode: dp.mode,
      contextTokens: dp.contextTokens,
      prefillSpeed: dp.prefillSpeed,
      generationSpeed: dp.generationSpeed,
      totalTime: dp.totalTime,
      aiTime: dp.aiTime,
    })),
  }
}

export function StatsModal({ isOpen, onClose, stats, model }: StatsModalProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  // Prepare chart data
  const chartData = stats.dataPoints.map(dp => ({
    context: dp.contextTokens,
    ppSpeed: dp.prefillSpeed,
    tgSpeed: dp.generationSpeed,
  }))

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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="AI Time" value={formatTime(stats.aiTime)} />
            <StatCard label="Total Time" value={formatTime(stats.totalTime)} />
            <StatCard label="Tool Time" value={formatTime(stats.toolTime)} />
            <StatCard label="LLM Calls" value={stats.messageCount.toString()} />
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
        {stats.dataPoints.length > 1 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                Performance Progression
              </h3>
              <div className="flex gap-2">
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
              <DualSparkline data={chartData} width={50} />
            </div>
          </section>
        )}

        {/* Call Log */}
        <section>
          <h3 className="text-sm font-semibold text-text-secondary mb-3 uppercase tracking-wide">
            Call Log ({stats.dataPoints.length} calls)
          </h3>
          <div className="max-h-60 overflow-y-auto bg-bg-tertiary/30 rounded">
            {stats.dataPoints.map((dp, i) => (
              <DataPointRow key={dp.messageId} dataPoint={dp} index={i} />
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
 * Single row in the call log
 */
function DataPointRow({ 
  dataPoint, 
  index 
}: { 
  dataPoint: StatsDataPoint
  index: number 
}) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2 text-xs ${
      index % 2 === 0 ? 'bg-bg-tertiary/20' : ''
    }`}>
      {/* Index */}
      <span className="text-text-muted w-6 text-right">#{index + 1}</span>
      
      {/* Timestamp */}
      <span className="text-text-muted w-20 font-mono">
        {formatTimestamp(dataPoint.timestamp)}
      </span>
      
      {/* Mode badge */}
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getModeColor(dataPoint.mode)}`}>
        {dataPoint.mode}
      </span>
      
      {/* Context size */}
      <span className="text-text-secondary w-16 text-right font-mono">
        {formatTokens(dataPoint.contextTokens)} ctx
      </span>
      
      {/* AI Time */}
      <span className="text-text-secondary w-12 text-right">
        {dataPoint.aiTime.toFixed(1)}s
      </span>
      
      {/* Speeds */}
      <span className="text-text-muted flex-1 text-right font-mono">
        {formatSpeed(dataPoint.prefillSpeed)} pp · {formatSpeed(dataPoint.generationSpeed)} tg
      </span>
    </div>
  )
}
