import { useState, useCallback, useEffect } from 'react'
import { Modal } from './shared/SelfContainedModal'
import { Button } from './shared/Button'
import { useT } from '../hooks/useT'
import { authFetch } from '../lib/api'

interface PermissionDeniedModalProps {
  isOpen: boolean
  onClose: () => void
  path: string
  onRetry: () => void
}

type PermissionFixAction = 'group' | 'join_group' | 'join_group_and_group'

interface PermissionOptions {
  sudoAvailable: boolean
  userInGroup: boolean
  groupHasWrite: boolean
  groupName: string | null
}

export function PermissionDeniedModal({ isOpen, onClose, path, onRetry }: PermissionDeniedModalProps) {
  const t = useT()
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
    async (action: PermissionFixAction) => {
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
            t({
              en: 'Passwordless sudo is not available. Please fix permissions manually:',
              fr: 'Le sudo sans mot de passe n’est pas disponible. Veuillez corriger les permissions manuellement :',
            }) +
              '\n\n' +
              (action === 'group' ? `sudo chmod g+w "${path}"` : `sudo usermod -aG <group> $USER`),
          )
        } else {
          setError(
            t({ en: 'Failed to fix permissions:', fr: 'Échec de la correction des permissions :' }) +
              ' ' +
              (data.error || t({ en: 'Unknown error', fr: 'Erreur inconnue' })),
          )
        }
      } catch (err) {
        setError(
          t({ en: 'Failed to fix permissions:', fr: 'Échec de la correction des permissions :' }) +
            ' ' +
            (err instanceof Error ? err.message : t({ en: 'Unknown error', fr: 'Erreur inconnue' })),
        )
      } finally {
        setLoading(false)
      }
    },
    [path, onRetry, onClose, t],
  )

  const userInGroup = options?.userInGroup ?? false
  const groupHasWrite = options?.groupHasWrite ?? false
  const sudoAvailable = options?.sudoAvailable ?? false
  const groupName = options?.groupName ?? ''

  const showExtendGroup = userInGroup && !groupHasWrite
  const showJoinGroup = !userInGroup && groupHasWrite
  const showJoinGroupAndExtend = !userInGroup && !groupHasWrite

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t({ en: 'Permission Denied', fr: 'Permission refusée' })}
      size="sm"
      footer={
        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            {t({ en: 'Cancel', fr: 'Annuler' })}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="text-sm text-text-secondary">
          <p>
            {showExtendGroup ? (
              <>
                {t({ en: 'The group', fr: 'Le groupe' })} <strong>{groupName}</strong>{' '}
                {t({ en: "doesn't have write access:", fr: "n'a pas les droits d'écriture :" })}
              </>
            ) : showJoinGroup ? (
              <>
                {t({ en: "You're not a member of group", fr: "Vous n'êtes pas membre du groupe" })}{' '}
                <strong>{groupName}</strong>
                {t({ en: ':', fr: ' :' })}
              </>
            ) : (
              <>
                {t({ en: "You're not a member of group", fr: "Vous n'êtes pas membre du groupe" })}{' '}
                <strong>{groupName}</strong>{' '}
                {t({ en: 'and it does not have write access:', fr: "et il n'a pas les droits d'écriture :" })}
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
              <SudoAction
                action="group"
                loadingLabel={t({ en: 'Granting access...', fr: 'Octroi des accès…' })}
                label={t({ en: 'Extend group permissions', fr: 'Étendre les permissions du groupe' })}
                command={`sudo chmod g+w "${path}"`}
                loading={loading}
                sudoAvailable={sudoAvailable}
                onFix={handleFixPermissions}
              />
            )}
            {showJoinGroup && (
              <SudoAction
                action="join_group"
                loadingLabel={t({ en: 'Joining group...', fr: 'Adhésion au groupe…' })}
                label={t({ en: 'Join group', fr: 'Rejoindre le groupe' })}
                command={`sudo usermod -aG ${groupName} $USER`}
                loading={loading}
                sudoAvailable={sudoAvailable}
                onFix={handleFixPermissions}
              />
            )}
            {showJoinGroupAndExtend && (
              <SudoAction
                action="join_group_and_group"
                loadingLabel={t({ en: 'Joining group...', fr: 'Adhésion au groupe…' })}
                label={t({
                  en: 'Join group & grant write permissions',
                  fr: 'Rejoindre le groupe et accorder les droits d’écriture',
                })}
                command={`sudo usermod -aG ${groupName} $USER\nsudo chmod g+w "${path}"`}
                loading={loading}
                sudoAvailable={sudoAvailable}
                onFix={handleFixPermissions}
              />
            )}
            {!sudoAvailable && !error && (
              <div className="text-xs text-text-secondary">
                <p>
                  {t({
                    en: 'Passwordless sudo is not available. Please fix permissions manually:',
                    fr: 'Le sudo sans mot de passe n’est pas disponible. Veuillez corriger les permissions manuellement :',
                  })}
                </p>
                <code className="block mt-1 p-2 bg-bg-tertiary rounded break-all">sudo chmod g+w "{path}"</code>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

function SudoAction({
  action,
  loadingLabel,
  label,
  command,
  loading,
  sudoAvailable,
  onFix,
}: {
  action: PermissionFixAction
  loadingLabel: string
  label: string
  command: string
  loading: boolean
  sudoAvailable: boolean
  onFix: (action: PermissionFixAction) => void
}) {
  const t = useT()
  return (
    <>
      <Button
        type="button"
        variant="primary"
        onClick={() => onFix(action)}
        disabled={loading || !sudoAvailable}
        className="w-full"
      >
        {loading ? loadingLabel : label}
      </Button>
      <div className="text-xs text-text-secondary">
        {t({ en: 'Or manually execute:', fr: 'Ou exécutez manuellement :' })}
      </div>
      <code className="text-xs text-text-muted p-2 bg-bg-tertiary rounded break-all whitespace-pre-line">
        {command}
      </code>
    </>
  )
}
