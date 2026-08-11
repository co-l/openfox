import { useEffect } from 'react'
import { usePermissionsStore } from '../../../stores/permissions'
import { useSessionStore } from '../../../stores/session'
import { PermissionsList } from '../permissions-shared'
import type { PermissionScope } from '@shared/permissions.js'

export function PermissionsTab() {
  const { mergedRules, loading, saving, error, fetchAll, addRule, updateRule, deleteRule } = usePermissionsStore()
  const currentSession = useSessionStore((s) => s.currentSession)
  const workdir = currentSession?.workspace ?? currentSession?.workdir

  useEffect(() => {
    fetchAll(workdir)
  }, [fetchAll, workdir])

  if (loading && mergedRules.length === 0) {
    return <div className="text-sm text-text-muted">Loading permissions...</div>
  }

  // Map a merged-list display index to the index within its scope's config.
  // mergedRules = [...globalRules, ...projectRules], each tagged with scope.
  const scopeIndexOf = (displayIndex: number): { scope: PermissionScope; index: number } => {
    const rule = mergedRules[displayIndex]
    if (!rule) return { scope: 'project' as const, index: 0 }
    let index = 0
    for (let i = 0; i < displayIndex; i++) {
      if (mergedRules[i]!.scope === rule.scope) index++
    }
    return { scope: rule.scope, index }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-sm text-accent-error bg-accent-error/10 border border-accent-error/30 rounded-lg p-3 flex justify-between items-center">
          <span>Failed to load permissions: {error}</span>
          <button onClick={() => fetchAll(workdir)} className="text-xs text-accent-primary hover:underline ml-2">
            Retry
          </button>
        </div>
      )}
      {!workdir && (
        <div className="text-sm text-text-muted bg-bg-tertiary border border-border rounded-lg p-3">
          No active project — showing global rules only.
        </div>
      )}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-1">Permission Rules</h3>
        <p className="text-sm text-text-muted mb-3">
          Deterministic rules (not LLM-managed) that allow, deny, or force-ask for tool actions. DENY always wins, even
          in dangerous mode. ALLOW skips sandbox and sensitive-file checks for matching paths. Project rules are stored
          in <code>.openfox/permissions.json</code>, global rules in your OpenFox config directory.
        </p>
      </div>
      <PermissionsList
        rules={mergedRules}
        saving={saving}
        allowProject={!!workdir}
        onAdd={async (rule, scope) => {
          await addRule(scope, rule, workdir)
        }}
        onUpdate={async (displayIndex, rule) => {
          const { scope, index } = scopeIndexOf(displayIndex)
          await updateRule(scope, index, rule, workdir)
        }}
        onDelete={async (displayIndex) => {
          const { scope, index } = scopeIndexOf(displayIndex)
          await deleteRule(scope, index, workdir)
        }}
      />
    </div>
  )
}
