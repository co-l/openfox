import { useState, useCallback, useEffect } from 'react'
import { Modal } from './shared/SelfContainedModal'
import { Button } from './shared/Button'
import { authFetch } from '../lib/api'

interface PermissionDeniedModalProps {
  isOpen: boolean
  onClose: () => void
  path: string
  onRetry: () => void
}

interface PermissionOptions {
  sudoAvailable: boolean
  userInGroup: boolean
  groupHasWrite: boolean
  groupName: string | null
}

export function PermissionDeniedModal({ isOpen, onClose, path, onRetry }: PermissionDeniedModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState<PermissionOptions | null>(null)

  useEffect(() => {
    if (isOpen) {
      checkPermissionOptions()
    }
  }, [isOpen])

  const checkPermissionOptions = async () => {
    try {
      const res = await authFetch('/api/projects/check-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      const data = await res.json()
      setOptions({
        sudoAvailable: data.sudoAvailable,
        userInGroup: data.userInGroup,
        groupHasWrite: data.groupHasWrite,
        groupName: data.groupName || null,
      })
    } catch {
      setOptions({ sudoAvailable: false, userInGroup: false, groupHasWrite: false, groupName: null })
    }
  }

  const handleFixPermissions = useCallback(
    async (action: 'group' | 'join_group' | 'join_group_and_group') => {
      setLoading(true)
      setError(null)
      try {
        const res = await authFetch('/api/projects/fix-permissions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, action }),
        })
        const data = await res.json()
        if (data.success) {
          onRetry()
          onClose()
        } else if (!data.sudoAvailable) {
          setError(
            'Passwordless sudo is not available. Please fix permissions manually:\n\n' +
              (action === 'group' ? `sudo chmod g+w "${path}"` : `sudo usermod -aG <group> $USER`),
          )
        } else {
          setError('Failed to fix permissions: ' + (data.error || 'Unknown error'))
        }
      } catch (err) {
        setError('Failed to fix permissions: ' + (err instanceof Error ? err.message : 'Unknown error'))
      } finally {
        setLoading(false)
      }
    },
    [path, onRetry, onClose],
  )

  const userInGroup = options?.userInGroup ?? false
  const groupHasWrite = options?.groupHasWrite ?? false
  const sudoAvailable = options?.sudoAvailable ?? false
  const groupName = options?.groupName ?? ''

  const showExtendGroup = userInGroup && !groupHasWrite
  const showJoinGroup = !userInGroup && groupHasWrite
  const showJoinGroupAndExtend = !userInGroup && !groupHasWrite

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Permission Denied" size="sm">
      <div className="space-y-4">
        <div className="text-sm text-text-secondary">
          <p>
            {showExtendGroup ? (
              <>
                The group <strong>{groupName}</strong> doesn't have write access:
              </>
            ) : showJoinGroup ? (
              <>
                You're not a member of group <strong>{groupName}</strong>:
              </>
            ) : (
              <>
                You're not a member of group <strong>{groupName}</strong> and it doesn't have write access:
              </>
            )}
          </p>
          <p className="mt-2 font-mono text-xs bg-bg-tertiary p-2 rounded break-all">{path}</p>
        </div>

        {error ? (
          <div className="p-3 bg-accent-error/10 border border-accent-error/30 rounded text-sm text-accent-error whitespace-pre-wrap">
            {error}
          </div>
        ) : options ? (
          <div className="flex flex-col gap-2">
            {showExtendGroup && (
              <>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => handleFixPermissions('group')}
                  disabled={loading || !sudoAvailable}
                  className="w-full"
                >
                  {loading ? 'Granting access...' : 'Extend group permissions'}
                </Button>
                <div className="text-xs text-text-secondary">Or manually execute:</div>
                <code className="text-xs text-text-muted p-2 bg-bg-tertiary rounded break-all">
                  sudo chmod g+w "{path}"
                </code>
              </>
            )}
            {showJoinGroup && (
              <>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => handleFixPermissions('join_group')}
                  disabled={loading || !sudoAvailable}
                  className="w-full"
                >
                  {loading ? 'Joining group...' : 'Join group'}
                </Button>
                <div className="text-xs text-text-secondary">Or manually execute:</div>
                <code className="text-xs text-text-muted p-2 bg-bg-tertiary rounded break-all">
                  sudo usermod -aG {groupName} $USER
                </code>
              </>
            )}
            {showJoinGroupAndExtend && (
              <>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => handleFixPermissions('join_group_and_group')}
                  disabled={loading || !sudoAvailable}
                  className="w-full"
                >
                  {loading ? 'Joining group...' : 'Join group & grant write permissions'}
                </Button>
                <div className="text-xs text-text-secondary">Or manually execute:</div>
                <code className="text-xs text-text-muted p-2 bg-bg-tertiary rounded break-all">
                  sudo usermod -aG {groupName} $USER
                  <br />
                  sudo chmod g+w "{path}"
                </code>
              </>
            )}
            {!sudoAvailable && !error && (
              <div className="text-xs text-text-secondary">
                <p>Passwordless sudo is not available. Please fix permissions manually:</p>
                <code className="block mt-1 p-2 bg-bg-tertiary rounded break-all">sudo chmod g+w "{path}"</code>
              </div>
            )}
            <div className="flex justify-end">
              <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
