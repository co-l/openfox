import { useSessionStore, type PendingPathConfirmation } from '../../stores/session'
import { Button } from './Button'

interface PathConfirmationDialogProps {
  confirmation: PendingPathConfirmation
}

function getReasonMessage(reason: PendingPathConfirmation['reason']): {
  title: string
  description: string
  warning: string
} {
  switch (reason) {
    case 'sensitive_file':
      return {
        title: 'Sensitive File Access',
        description: 'is trying to access files that may contain secrets (API keys, passwords, credentials):',
        warning: 'These files may contain sensitive information. Only allow access if you trust this operation.',
      }
    case 'both':
      return {
        title: 'Sensitive File Access',
        description: 'is trying to access sensitive files outside the project directory:',
        warning: 'These files may contain secrets and are outside your project. Only allow access if you trust this operation.',
      }
    case 'outside_workdir':
    default:
      return {
        title: 'Path Access Request',
        description: 'is trying to access paths outside the project directory:',
        warning: 'Allowing access will permit the tool to read, write, or execute commands involving these paths for this session.',
      }
  }
}

export function PathConfirmationDialog({ confirmation }: PathConfirmationDialogProps) {
  const confirmPath = useSessionStore(state => state.confirmPath)
  const { title, description, warning } = getReasonMessage(confirmation.reason)
  
  const handleAllow = () => {
    confirmPath(confirmation.callId, true)
  }
  
  const handleDeny = () => {
    confirmPath(confirmation.callId, false)
  }
  
  // Use red color scheme for sensitive files, amber for outside workdir
  const isSensitive = confirmation.reason === 'sensitive_file' || confirmation.reason === 'both'
  const colorClass = isSensitive ? 'text-red-400' : 'text-amber-400'
  const bgClass = isSensitive ? 'bg-red-500/10' : 'bg-amber-500/10'
  const pathColorClass = isSensitive ? 'text-red-300' : 'text-amber-300'
  const buttonClass = isSensitive ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-bg-secondary border border-border rounded shadow-xl max-w-lg w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className={`px-4 py-3 border-b border-border ${bgClass}`}>
          <div className="flex items-center gap-2">
            <svg className={`w-5 h-5 ${colorClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h2 className={`text-sm font-semibold ${colorClass}`}>{title}</h2>
          </div>
        </div>
        
        {/* Body */}
        <div className="px-4 py-3 space-y-3">
          <p className="text-sm text-text-secondary">
            The tool <code className="px-1 py-0.5 bg-bg-tertiary rounded text-text-primary">{confirmation.tool}</code> {description}
          </p>
          
          <div className="bg-bg-tertiary rounded p-2 max-h-40 overflow-y-auto">
            <ul className="space-y-1">
              {confirmation.paths.map((path, i) => (
                <li key={i} className={`text-xs font-mono ${pathColorClass} break-all`}>
                  {path}
                </li>
              ))}
            </ul>
          </div>
          
          <p className="text-xs text-text-muted">
            Project directory: <code className="px-1 py-0.5 bg-bg-tertiary rounded">{confirmation.workdir}</code>
          </p>
          
          <p className="text-xs text-text-muted">
            {warning}
          </p>
        </div>
        
        {/* Actions */}
        <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleDeny}
          >
            Deny
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleAllow}
            className={buttonClass}
          >
            Allow Access
          </Button>
        </div>
      </div>
    </div>
  )
}
