import { ScrollArea } from './ScrollArea'
import { useSessionStore, type PendingPathConfirmation } from '../../stores/session'
import { WarningSmallIcon } from './icons'
import { useSessionScope } from '../../stores/session/session-scope'

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
    case 'git_no_verify':
      return {
        title: 'Git --no-verify',
        description: 'Bypassing git hooks/pre-commit checks',
      }
    case 'rule_ask':
      return {
        title: 'Permission Rule Confirmation',
        description: 'A permission rule requires confirmation for this action',
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
  const sessionId = useSessionScope()
  const confirmPath = useSessionStore((state) => state.confirmPath)
  const switchDangerLevel = useSessionStore((state) => state.switchDangerLevel)
  const { title, description } = getReasonMessage(confirmation.reason)

  const isSensitive = confirmation.reason === 'sensitive_file' || confirmation.reason === 'both'
  const borderColor = isSensitive ? 'border-red-500/50' : 'border-amber-500/50'
  const bgColor = isSensitive ? 'bg-red-500/10' : 'bg-amber-500/10'

  const isGitNoVerify = confirmation.reason === 'git_no_verify'
  const isDangerousCommand = confirmation.reason === 'dangerous_command'
  const canAllowForSession = !isGitNoVerify && !isDangerousCommand

  const handleEnableDangerousAndAllow = () => {
    if (!sessionId) return
    switchDangerLevel(sessionId, 'dangerous')
    confirmPath(sessionId, confirmation.callId, true, false)
  }

  const handleAllowForSession = () => {
    if (!sessionId) return
    confirmPath(sessionId, confirmation.callId, true, true)
  }

  return (
    <div className={`border ${borderColor} ${bgColor} rounded p-3 my-2`}>
      <div className="flex items-center gap-2 mb-2">
        <WarningSmallIcon />
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium ${isSensitive ? 'text-red-400' : 'text-amber-400'}`}>{title}</div>
          <div className="text-xs text-text-muted">{description}</div>
        </div>
      </div>

      <div className="text-xs text-text-muted mb-2">
        <span className="font-medium">{confirmation.tool}</span> wants to access:
      </div>

      <ScrollArea className="bg-bg-primary rounded p-2 mb-3 max-h-24">
        <ul className="space-y-0.5">
          {confirmation.paths.map((path, i) => (
            <li key={i} className={`text-xs font-mono ${isSensitive ? 'text-red-300' : 'text-amber-300'} break-all`}>
              {path}
            </li>
          ))}
        </ul>
      </ScrollArea>

      <div className="flex gap-2">
        <button
          onClick={() => sessionId && confirmPath(sessionId, confirmation.callId, false)}
          className="flex-1 px-3 py-1.5 text-xs font-medium rounded bg-bg-tertiary hover:bg-bg-tertiary/80 text-text-secondary border border-border transition-colors"
        >
          Deny
        </button>
        <button
          onClick={() => sessionId && confirmPath(sessionId, confirmation.callId, true, false)}
          className="flex-1 px-3 py-1.5 text-xs font-medium rounded bg-accent-primary hover:bg-accent-primary/80 text-text-primary transition-colors"
        >
          Allow
        </button>
        <button
          onClick={handleAllowForSession}
          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${canAllowForSession ? 'bg-green-600 hover:bg-green-700 text-white' : 'hidden'}`}
          title="Allow for this session (won't ask again until session ends)"
        >
          Allow for this session
        </button>
        <button
          onClick={handleEnableDangerousAndAllow}
          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${isGitNoVerify ? 'hidden' : 'bg-red-600 hover:bg-red-700 text-white'}`}
          title="Enable dangerous mode and allow this request"
        >
          Allow Everything
        </button>
      </div>
    </div>
  )
}
