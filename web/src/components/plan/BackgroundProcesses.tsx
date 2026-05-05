import { memo, useState } from 'react'
import { useBackgroundProcessesStore } from '../../stores/background-processes'
import { LogViewer } from './LogViewer.tsx'

interface BackgroundProcessesProps {
  sessionId: string | undefined
}

export const BackgroundProcesses = memo(function BackgroundProcesses({ sessionId }: BackgroundProcessesProps) {
  const processes = useBackgroundProcessesStore((s) => s.processes)
  const stopProcess = useBackgroundProcessesStore((s) => s.stopProcess)
  const [expandedProcessId, setExpandedProcessId] = useState<string | null>(null)
  const [expandedLogs, setExpandedLogs] = useState<{ content: string; stream: 'stdout' | 'stderr' }[]>([])

  const activeProcesses = processes.filter((p) => p.status !== 'exited')
  const runningCount = activeProcesses.filter((p) => p.status === 'running').length

  if (processes.length === 0) {
    return null
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'bg-accent-success'
      case 'starting':
        return 'bg-accent-warning'
      case 'stopping':
        return 'bg-accent-warning'
      case 'exited':
        return 'bg-text-muted'
      default:
        return 'bg-text-muted'
    }
  }

  const handleExpandLogs = (processId: string) => {
    const logs = useBackgroundProcessesStore.getState().logs[processId] ?? []
    setExpandedLogs(logs.map((l) => ({ content: l.content, stream: l.stream })))
    setExpandedProcessId(processId)
  }

  const handleStop = (processId: string) => {
    if (sessionId) {
      stopProcess(processId, sessionId)
    }
  }

  return (
    <div className="mt-2 pt-3 border-t border-border space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 bg-accent-primary" />
          <h3 className="text-sm font-semibold text-text-primary">Background</h3>
          <span className="text-xs text-text-muted">({runningCount} running)</span>
        </div>
      </div>

      <div className="space-y-2">
        {activeProcesses.map((process) => (
          <div key={process.id} className="border border-border rounded p-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${getStatusColor(process.status)}`} />
                <span className="text-sm text-text-primary truncate" title={process.name}>
                  {process.name}
                </span>
                <span className="text-xs text-text-muted">[{process.status}]</span>
              </div>
              <div className="flex gap-1 ml-2">
                <button
                  onClick={() => handleExpandLogs(process.id)}
                  className="px-2 py-1 text-xs rounded bg-bg-tertiary hover:bg-border text-text-secondary transition-colors"
                  title="View logs"
                >
                  Logs
                </button>
                <button
                  onClick={() => handleStop(process.id)}
                  className="px-2 py-1 text-xs rounded bg-bg-tertiary hover:bg-accent-error/20 text-text-secondary hover:text-accent-error transition-colors"
                  title="Stop process"
                >
                  Stop
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {expandedProcessId && (
        <LogViewer
          title={activeProcesses.find((p) => p.id === expandedProcessId)?.name ?? ''}
          logs={expandedLogs}
          onClose={() => {
            setExpandedProcessId(null)
            setExpandedLogs([])
          }}
        />
      )}
    </div>
  )
})
