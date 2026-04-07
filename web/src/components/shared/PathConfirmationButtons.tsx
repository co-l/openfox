import { useSessionStore, type PendingPathConfirmation } from '../../stores/session'

interface PathConfirmationButtonsProps {
  confirmation: PendingPathConfirmation
}

function getReasonMessage(reason: PendingPathConfirmation['reason']): {
  title: string
  description: string
} {
  switch (reason) {
    case 'sensitive_file':
      return {
        title: 'Sensitive File Access',
        description: 'Accessing files that may contain secrets',
      }
    case 'both':
      return {
        title: 'Sensitive File Access',
        description: 'Accessing sensitive files outside project',
      }
    case 'dangerous_command':
      return {
        title: 'Dangerous Command',
        description: 'Running potentially dangerous command',
      }
    case 'outside_workdir':
    default:
      return {
        title: 'Path Access Request',
        description: 'Accessing paths outside project directory',
      }
  }
}

export function PathConfirmationButtons({ confirmation }: PathConfirmationButtonsProps) {
  const confirmPath = useSessionStore(state => state.confirmPath)
  const currentSession = useSessionStore(state => state.currentSession)
  const switchDangerLevel = useSessionStore(state => state.switchDangerLevel)
  const { title, description } = getReasonMessage(confirmation.reason)

  const isSensitive = confirmation.reason === 'sensitive_file' || confirmation.reason === 'both'
  const borderColor = isSensitive ? 'border-red-500/50' : 'border-amber-500/50'
  const bgColor = isSensitive ? 'bg-red-500/10' : 'bg-amber-500/10'

  const handleEnableDangerousAndAllow = () => {
    if (currentSession?.id) {
      switchDangerLevel('dangerous')
    }
    confirmPath(confirmation.callId, true, false)
  }

  return (
    <div className={`border ${borderColor} ${bgColor} rounded p-3 my-2`}>
      <div className="flex items-center gap-2 mb-2">
        <svg className={`w-4 h-4 ${isSensitive ? 'text-red-400' : 'text-amber-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium ${isSensitive ? 'text-red-400' : 'text-amber-400'}`}>
            {title}
          </div>
          <div className="text-xs text-text-muted">
            {description}
          </div>
        </div>
      </div>

      <div className="text-xs text-text-muted mb-2">
        <span className="font-medium">{confirmation.tool}</span>
        {' '}wants to access:
      </div>

      <div className="bg-bg-primary rounded p-2 mb-3 max-h-24 overflow-y-auto">
        <ul className="space-y-0.5">
          {confirmation.paths.map((path, i) => (
            <li key={i} className={`text-xs font-mono ${isSensitive ? 'text-red-300' : 'text-amber-300'} break-all`}>
              {path}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => confirmPath(confirmation.callId, false)}
          className="flex-1 px-3 py-1.5 text-xs font-medium rounded bg-bg-tertiary hover:bg-bg-tertiary/80 text-text-secondary border border-border transition-colors"
        >
          Deny
        </button>
        <button
          onClick={() => confirmPath(confirmation.callId, true, false)}
          className="flex-1 px-3 py-1.5 text-xs font-medium rounded bg-accent-primary hover:bg-accent-primary/80 text-white transition-colors"
        >
          Allow
        </button>
        <button
          onClick={handleEnableDangerousAndAllow}
          className="flex-1 px-3 py-1.5 text-xs font-medium rounded bg-red-600 hover:bg-red-700 text-white transition-colors"
          title="Enable dangerous mode and allow this request"
        >
          Allow Everything
        </button>
      </div>
    </div>
  )
}