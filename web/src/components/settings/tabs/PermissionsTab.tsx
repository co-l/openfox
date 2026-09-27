import { useEffect } from 'react'
import { usePermissionsStore } from '../../../stores/permissions'
import { useSessionStore } from '../../../stores/session'
import { useT } from '../../../hooks/useT'
import { PermissionsList } from '../permissions-shared'
import { SessionGrantsList } from '../SessionGrantsList'

export function PermissionsTab() {
  const t = useT()
  const {
    mergedRules,
    grants,
    loading,
    saving,
    error,
    fetchAll,
    fetchGrants,
    addRule,
    updateRule,
    deleteRule,
    revokeGrantedPath,
    revokeGrantedRule,
    revokeSessionGrants,
  } = usePermissionsStore()
  const sessions = useSessionStore((s) => s.sessions)
  const currentSession = useSessionStore((s) => s.currentSession)
  const workdir = currentSession?.workspace ?? currentSession?.workdir

  useEffect(() => {
    fetchAll(workdir)
  }, [fetchAll, workdir])

  useEffect(() => {
    void fetchGrants()
  }, [fetchGrants])

  const sessionTitles = Object.fromEntries((sessions ?? []).map((session) => [session.id, session.title ?? session.id]))

  if (loading && mergedRules.length === 0) {
    return (
      <div className="text-sm text-text-muted">
        {t({ en: 'Loading permissions…', fr: 'Chargement des permissions…' })}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-sm text-accent-error bg-accent-error/10 border border-accent-error/30 rounded-lg p-3 flex justify-between items-center">
          <span>
            {t(
              { en: 'Failed to load permissions: {{error}}', fr: 'Échec du chargement des permissions : {{error}}' },
              { error },
            )}
          </span>
          <button onClick={() => fetchAll(workdir)} className="text-xs text-accent-primary hover:underline ml-2">
            {t({ en: 'Retry', fr: 'Réessayer' })}
          </button>
        </div>
      )}
      {!workdir && (
        <div className="text-sm text-text-muted bg-bg-tertiary border border-border rounded-lg p-3">
          {t({
            en: 'No active project — showing global rules only.',
            fr: 'Aucun projet actif — seules les règles globales sont affichées.',
          })}
        </div>
      )}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-1">
          {t({ en: 'Permission Rules', fr: 'Règles de permission' })}
        </h3>
        <p className="text-sm text-text-muted mb-3">
          {t({
            en: 'Deterministic rules (not LLM-managed) that allow, deny, or force-ask for tool actions. DENY always wins, even in dangerous mode. ALLOW skips sandbox and sensitive-file checks for matching paths. Project rules are stored in your local OpenFox database, global rules in your OpenFox config directory.',
            fr: 'Règles déterministes (non gérées par le LLM) qui autorisent, refusent ou forcent une confirmation pour les actions des outils. DENY l’emporte toujours, même en mode dangereux. ALLOW contourne les contrôles de bac à sable et de fichiers sensibles pour les chemins correspondants. Les règles projet sont stockées dans votre base OpenFox locale, les règles globales dans votre dossier de configuration OpenFox.',
          })}
        </p>
      </div>
      <PermissionsList
        rules={mergedRules}
        saving={saving}
        allowProject={!!workdir}
        onAdd={async (rule, scope) => {
          await addRule(scope, rule, workdir)
        }}
        onUpdate={async (id, rule, scope) => {
          await updateRule(scope, id, rule, workdir)
        }}
        onDelete={async (id, scope) => {
          await deleteRule(scope, id, workdir)
        }}
      />
      <SessionGrantsList
        grants={grants}
        sessionTitles={sessionTitles}
        saving={saving}
        onRefresh={() => void fetchGrants()}
        onRevokePath={revokeGrantedPath}
        onRevokeRule={revokeGrantedRule}
        onRevokeSession={revokeSessionGrants}
      />
    </div>
  )
}
