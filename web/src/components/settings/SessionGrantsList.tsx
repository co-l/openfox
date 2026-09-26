import { useState } from 'react'
import type { PermissionRule, SessionGrantReason, SessionGrants } from '@shared/permissions.js'
import { useT } from '../../hooks/useT'
import { Button } from '../shared/Button'
import { ConfirmModal } from '../shared/ConfirmModal'
import { TrashIcon } from '../shared/icons'

type Access = 'read' | 'write' | 'command' | 'other'

function accessOf(tool: string | undefined): Access {
  if (tool === 'read_file') return 'read'
  if (tool === 'write_file' || tool === 'edit_file') return 'write'
  if (tool === 'run_command') return 'command'
  return 'other'
}

function useAccessLabel() {
  const t = useT()
  return (access: Access, tool: string): string => {
    if (access === 'read') return t({ en: 'read', fr: 'lecture' })
    if (access === 'write') return t({ en: 'write', fr: 'écriture' })
    if (access === 'command') return t({ en: 'command', fr: 'commande' })
    return tool
  }
}

function useReasonLabel() {
  const t = useT()
  return (reason: SessionGrantReason | undefined): string | null => {
    switch (reason) {
      case 'outside_workdir':
        return t({ en: 'outside the project', fr: 'hors du projet' })
      case 'sensitive_file':
        return t({ en: 'sensitive file', fr: 'fichier sensible' })
      case 'both':
        return t({ en: 'outside the project, sensitive file', fr: 'hors du projet, fichier sensible' })
      case 'rule_ask':
        return t({ en: 'ASK rule', fr: 'règle ASK' })
      case 'dangerous_auto':
        return t({ en: 'auto-approved (dangerous mode)', fr: 'approuvé auto (mode dangereux)' })
      default:
        return null
    }
  }
}

function GrantRow({
  kind,
  detail,
  meta,
  onRevoke,
}: {
  kind: string
  detail: string
  meta: string[]
  onRevoke: () => void
}) {
  const t = useT()
  return (
    <div className="flex items-start gap-3 p-2 border border-border rounded">
      <span className="text-xs px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted shrink-0">
        {t({ en: 'Session', fr: 'Session' })}
      </span>
      <span className="text-xs px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted shrink-0">{kind}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-mono text-text-primary truncate" title={detail}>
          {detail}
        </div>
        <div className="text-xs text-text-muted">{meta.join(' · ')}</div>
      </div>
      <button
        onClick={onRevoke}
        title={t({ en: 'Revoke', fr: 'Révoquer' })}
        className="p-1 text-text-muted hover:text-red-400"
      >
        <TrashIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

/**
 * Audit view of "Allow for this session" approvals: what each session may do
 * without asking again, with per-item and per-session revocation.
 */
export function SessionGrantsList({
  grants,
  sessionTitles,
  saving,
  onRefresh,
  onRevokePath,
  onRevokeRule,
  onRevokeSession,
}: {
  grants: SessionGrants[]
  sessionTitles: Record<string, string>
  saving: boolean
  onRefresh: () => void
  onRevokePath: (sessionId: string, path: string) => Promise<void>
  onRevokeRule: (sessionId: string, rule: PermissionRule) => Promise<void>
  onRevokeSession: (sessionId: string) => Promise<void>
}) {
  const t = useT()
  const [revokeSessionId, setRevokeSessionId] = useState<string | null>(null)
  const accessLabel = useAccessLabel()
  const reasonLabel = useReasonLabel()
  const formatTime = (ms: number) => (ms > 0 ? new Date(ms).toLocaleString() : null)

  const handleRevokeSession = async () => {
    if (revokeSessionId === null) return
    await onRevokeSession(revokeSessionId)
    setRevokeSessionId(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-text-primary mb-1">
            {t({ en: 'Session grants', fr: 'Autorisations de session' })}
          </h3>
          <p className="text-sm text-text-muted">
            {t({
              en: 'Temporary approvals given with “Allow for this session”, kept in memory only: they end when revoked, when the session is deleted or when the server restarts. Permanent permissions are the rules listed above. A path grant applies to every tool on that path; a rule grant covers everything its pattern matches, for its tool only.',
              fr: 'Approbations temporaires données avec « Autoriser pour cette session », gardées en mémoire uniquement : elles s’arrêtent à la révocation, à la suppression de la session ou au redémarrage du serveur. Les permissions permanentes sont les règles listées au-dessus. Une autorisation de chemin vaut pour tous les outils sur ce chemin ; une autorisation de règle couvre tout ce qui correspond à son motif, pour son outil uniquement.',
            })}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onRefresh} disabled={saving}>
          {t({ en: 'Refresh', fr: 'Actualiser' })}
        </Button>
      </div>

      {grants.length === 0 && (
        <div className="text-sm text-text-muted py-4 text-center border border-border rounded">
          {t({ en: 'No active session grants.', fr: 'Aucune autorisation de session active.' })}
        </div>
      )}

      {grants.map((grant) => (
        <div key={grant.sessionId} className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-text-primary truncate">
              {sessionTitles[grant.sessionId] ??
                t({ en: 'Session {{id}}', fr: 'Session {{id}}' }, { id: grant.sessionId.slice(0, 8) })}
            </span>
            <Button
              variant="danger"
              size="sm"
              className="ml-auto"
              onClick={() => setRevokeSessionId(grant.sessionId)}
              disabled={saving}
            >
              {t({ en: 'Revoke all', fr: 'Tout révoquer' })}
            </Button>
          </div>
          {grant.rules.map((rule) => (
            <GrantRow
              key={`rule:${rule.tool}:${rule.pattern ?? ''}`}
              kind={t({ en: 'Rule', fr: 'Règle' })}
              detail={`${rule.tool} ${rule.pattern ?? t({ en: '(all calls)', fr: '(tous les appels)' })}`}
              meta={[
                t(
                  { en: 'allows {{access}} only', fr: 'autorise {{access}} uniquement' },
                  { access: accessLabel(accessOf(rule.tool), rule.tool) },
                ),
                t({ en: 'every path or command matching the pattern', fr: 'tout chemin ou commande du motif' }),
                formatTime(rule.grantedAt),
              ].filter((part): part is string => !!part)}
              onRevoke={() => void onRevokeRule(grant.sessionId, rule)}
            />
          ))}
          {grant.paths.map((grant_) => (
            <GrantRow
              key={`path:${grant_.path}`}
              kind={t({ en: 'Path', fr: 'Chemin' })}
              detail={grant_.path}
              meta={[
                t({
                  en: 'allows read, write and commands on this path',
                  fr: 'autorise lecture, écriture et commandes sur ce chemin',
                }),
                grant_.tool
                  ? t(
                      { en: 'approved on {{tool}}', fr: 'approuvé sur {{tool}}' },
                      { tool: `${accessLabel(accessOf(grant_.tool), grant_.tool)} (${grant_.tool})` },
                    )
                  : null,
                reasonLabel(grant_.reason),
                formatTime(grant_.grantedAt),
              ].filter((part): part is string => !!part)}
              onRevoke={() => void onRevokePath(grant.sessionId, grant_.path)}
            />
          ))}
        </div>
      ))}

      <ConfirmModal
        isOpen={revokeSessionId !== null}
        title={t({ en: 'Revoke all grants', fr: 'Révoquer toutes les autorisations' })}
        message={t({
          en: 'Every approval of this session will ask again next time.',
          fr: 'Toutes les approbations de cette session redemanderont confirmation.',
        })}
        confirmLabel={t({ en: 'Revoke all', fr: 'Tout révoquer' })}
        onClose={() => setRevokeSessionId(null)}
        onConfirm={() => void handleRevokeSession()}
        confirmVariant="danger"
      />
    </div>
  )
}
