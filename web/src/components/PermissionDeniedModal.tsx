import { useState, useCallback } from 'react'
import { Modal } from './shared/SelfContainedModal'
import { Button } from './shared/Button'
import { authFetch } from '../lib/api'

interface PermissionDeniedModalProps {
  isOpen: boolean
  onClose: () => void
  path: string
  onRetry: () => void
}

export function PermissionDeniedModal({ isOpen, onClose, path, onRetry }: PermissionDeniedModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleTakeOwnership = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch('/api/projects/fix-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      const data = await res.json()
      if (data.success) {
        onRetry()
        onClose()
      } else if (!data.sudoAvailable) {
        setError('Passwordless sudo is not available. Please fix permissions manually by running: sudo chown -R $USER "' + path + '"')
      } else {
        setError('Failed to fix permissions: ' + (data.error || 'Unknown error'))
      }
    } catch (err) {
      setError('Failed to fix permissions: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }, [path, onRetry, onClose])

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Permission Denied"
      size="sm"
    >
      <div className="space-y-4">
        <div className="text-sm text-text-secondary">
          <p>
            OpenFox does not have permission to create a project at:
          </p>
          <p className="mt-2 font-mono text-xs bg-bg-tertiary p-2 rounded break-all">{path}</p>
        </div>

        {error ? (
          <div className="p-3 bg-accent-error/10 border border-accent-error/30 rounded text-sm text-accent-error">
            {error}
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleTakeOwnership}
              disabled={loading}
              className="min-w-[140px]"
            >
              {loading ? 'Taking ownership...' : 'Take ownership'}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
