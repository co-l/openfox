import { useSessionStore, type PendingPathConfirmation } from '../../stores/session'
import { Button } from './Button'

interface PathConfirmationDialogProps {
  confirmation: PendingPathConfirmation
}

export function PathConfirmationDialog({ confirmation }: PathConfirmationDialogProps) {
  const confirmPath = useSessionStore(state => state.confirmPath)
  
  const handleAllow = () => {
    confirmPath(confirmation.callId, true)
  }
  
  const handleDeny = () => {
    confirmPath(confirmation.callId, false)
  }
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-bg-secondary border border-border rounded shadow-xl max-w-lg w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border bg-amber-500/10">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h2 className="text-sm font-semibold text-amber-400">Path Access Request</h2>
          </div>
        </div>
        
        {/* Body */}
        <div className="px-4 py-3 space-y-3">
          <p className="text-sm text-text-secondary">
            The tool <code className="px-1 py-0.5 bg-bg-tertiary rounded text-text-primary">{confirmation.tool}</code> is trying to access paths outside the project directory:
          </p>
          
          <div className="bg-bg-tertiary rounded p-2 max-h-40 overflow-y-auto">
            <ul className="space-y-1">
              {confirmation.paths.map((path, i) => (
                <li key={i} className="text-xs font-mono text-amber-300 break-all">
                  {path}
                </li>
              ))}
            </ul>
          </div>
          
          <p className="text-xs text-text-muted">
            Project directory: <code className="px-1 py-0.5 bg-bg-tertiary rounded">{confirmation.workdir}</code>
          </p>
          
          <p className="text-xs text-text-muted">
            Allowing access will permit the tool to read, write, or execute commands involving these paths for this session.
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
            className="bg-amber-600 hover:bg-amber-700"
          >
            Allow Access
          </Button>
        </div>
      </div>
    </div>
  )
}
