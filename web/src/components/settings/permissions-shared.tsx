import { useState, useEffect } from 'react'
import type { PermissionEffect, PermissionRule, PermissionScope, ScopedPermissionRule } from '@shared/permissions.js'
import { authFetch } from '../../lib/api'
import { Button } from '../shared/Button'
import { ConfirmModal } from '../shared/ConfirmModal'

export const EFFECT_COLORS: Record<PermissionEffect, string> = {
  DENY: 'text-red-400 bg-red-500/10 border-red-500/30',
  ALLOW: 'text-green-400 bg-green-500/10 border-green-500/30',
  ASK: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
}

export const SCOPE_COLORS: Record<PermissionScope, string> = {
  global: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
  project: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
}

export const EFFECTS: PermissionEffect[] = ['DENY', 'ALLOW', 'ASK']

const FALLBACK_TOOLS = ['read_file', 'write_file', 'edit_file', 'run_command']

const PATTERN_TOOLS = new Set(['read_file', 'write_file', 'edit_file', 'run_command'])

export function EffectBadge({ effect }: { effect: PermissionEffect }) {
  return <span className={`text-xs font-medium px-2 py-0.5 rounded border ${EFFECT_COLORS[effect]}`}>{effect}</span>
}

export function ScopeBadge({ scope }: { scope: PermissionScope }) {
  return <span className={`text-xs font-medium px-2 py-0.5 rounded border ${SCOPE_COLORS[scope]}`}>{scope}</span>
}

export function RuleForm({
  initial,
  initialScope = 'project',
  onSave,
  onCancel,
  saving = false,
  hideScope = false,
  allowProject = true,
}: {
  initial?: PermissionRule
  initialScope?: PermissionScope
  onSave: (rule: PermissionRule, scope: PermissionScope) => void
  onCancel: () => void
  saving?: boolean
  hideScope?: boolean
  allowProject?: boolean
}) {
  const [effect, setEffect] = useState<PermissionEffect>(initial?.effect ?? 'DENY')
  const [tool, setTool] = useState(initial?.tool ?? 'read_file')
  const [pattern, setPattern] = useState(initial?.pattern ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [scope, setScope] = useState<PermissionScope>(!allowProject ? 'global' : (initialScope ?? 'project'))
  const [tools, setTools] = useState<string[]>(FALLBACK_TOOLS)

  useEffect(() => {
    authFetch('/api/tools')
      .then((r) => r.json())
      .then((d: { tools?: { name: string }[] }) => {
        const names = (d.tools ?? []).map((t) => t.name)
        if (names.length > 0) setTools(names)
      })
      .catch(() => {
        // fallback already set
      })
  }, [])

  const handleSave = () => {
    const rule: PermissionRule = {
      effect,
      tool,
      ...(pattern.trim() ? { pattern: pattern.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
    }
    onSave(rule, scope)
  }

  const isCommandTool = tool === 'run_command'
  const isPatternTool = PATTERN_TOOLS.has(tool)
  const allowedEffects: PermissionEffect[] = isPatternTool ? EFFECTS : ['DENY']

  return (
    <div className="space-y-3 p-3 border border-border rounded-lg bg-bg-tertiary">
      <div className={hideScope ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-3 gap-3'}>
        <div>
          <label className="text-xs text-text-muted block mb-1">Effect</label>
          <select
            value={effect}
            onChange={(e) => setEffect(e.target.value as PermissionEffect)}
            className="w-full px-2 py-1 text-sm text-text-primary bg-bg-primary border border-border rounded"
          >
            {allowedEffects.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-text-muted block mb-1">Tool</label>
          <select
            value={tool}
            onChange={(e) => {
              const newTool = e.target.value
              setTool(newTool)
              if (!PATTERN_TOOLS.has(newTool)) {
                setEffect('DENY')
                setPattern('')
              }
            }}
            className="w-full px-2 py-1 text-sm text-text-primary bg-bg-primary border border-border rounded"
          >
            {tools.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        {!hideScope && (
          <div>
            <label className="text-xs text-text-muted block mb-1">Scope</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as PermissionScope)}
              className="w-full px-2 py-1 text-sm text-text-primary bg-bg-primary border border-border rounded"
            >
              <option value="project" disabled={!allowProject}>
                Project{!allowProject ? ' (no active session)' : ''}
              </option>
              <option value="global">Global</option>
            </select>
          </div>
        )}
      </div>
      <div>
        <label className="text-xs text-text-muted block mb-1">
          Pattern{' '}
          <span className="text-text-muted/60">
            {isPatternTool
              ? `(optional, glob: ${isCommandTool ? '`*` matches anything' : '`**` for any depth, `*` for one segment'})`
              : '(not applicable — this tool has no path/command target)'}
          </span>
        </label>
        <input
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          disabled={!isPatternTool}
          placeholder={isCommandTool ? 'terragrunt destroy *' : isPatternTool ? '/path/** or **/.env*' : 'N/A'}
          className="w-full px-2 py-1 text-sm font-mono text-text-primary bg-bg-primary border border-border rounded disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>
      <div>
        <label className="text-xs text-text-muted block mb-1">Description (optional)</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Why this rule exists"
          className="w-full px-2 py-1 text-sm text-text-primary bg-bg-primary border border-border rounded"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

export function RuleRow({
  rule,
  onEdit,
  onDelete,
}: {
  rule: ScopedPermissionRule
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-3 p-2 border border-border rounded">
      <EffectBadge effect={rule.effect} />
      <ScopeBadge scope={rule.scope} />
      <span className="text-sm text-text-primary">{rule.tool}</span>
      {rule.pattern && <span className="text-xs font-mono text-text-muted flex-1 truncate">{rule.pattern}</span>}
      {!rule.pattern && <span className="text-xs text-text-muted/60 flex-1 italic">(all calls)</span>}
      {rule.description && (
        <span className="text-xs text-text-muted/80 truncate max-w-[200px]" title={rule.description}>
          — {rule.description}
        </span>
      )}
      <div className="flex gap-1 ml-auto">
        <button onClick={onEdit} title="Edit" className="p-1 text-text-muted hover:text-text-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>
        <button onClick={onDelete} title="Delete" className="p-1 text-text-muted hover:text-red-400">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export function PermissionsList({
  rules,
  saving,
  onAdd,
  onUpdate,
  onDelete,
  emptyMessage = 'No permission rules. Add one to allow/deny tool actions without prompts.',
  hideScope = false,
  allowProject = true,
}: {
  rules: ScopedPermissionRule[]
  saving: boolean
  onAdd: (rule: PermissionRule, scope: PermissionScope) => Promise<void>
  onUpdate: (index: number, rule: PermissionRule, scope: PermissionScope) => Promise<void>
  onDelete: (index: number, scope: PermissionScope) => Promise<void>
  emptyMessage?: string
  hideScope?: boolean
  allowProject?: boolean
}) {
  const [showForm, setShowForm] = useState(false)
  const [editIndex, setEditIndex] = useState<number | null>(null)
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null)

  const handleSave = async (rule: PermissionRule, scope: PermissionScope) => {
    if (editIndex !== null) {
      await onUpdate(editIndex, rule, scope)
    } else {
      await onAdd(rule, scope)
    }
    setShowForm(false)
    setEditIndex(null)
  }

  const handleDelete = async () => {
    if (deleteIndex !== null) {
      const rule = rules[deleteIndex]
      if (rule) await onDelete(deleteIndex, rule.scope)
      setDeleteIndex(null)
    }
  }

  return (
    <>
      {showForm ? (
        <RuleForm
          initial={editIndex !== null ? rules[editIndex] : undefined}
          initialScope={editIndex !== null ? rules[editIndex]?.scope : undefined}
          onSave={handleSave}
          onCancel={() => {
            setShowForm(false)
            setEditIndex(null)
          }}
          saving={saving}
          hideScope={hideScope || editIndex !== null}
          allowProject={allowProject}
        />
      ) : (
        <Button variant="primary" size="sm" onClick={() => setShowForm(true)} disabled={saving}>
          {saving ? 'Saving...' : '+ Add Rule'}
        </Button>
      )}

      {rules.length === 0 && !showForm && (
        <div className="text-sm text-text-muted py-4 text-center border border-border rounded">{emptyMessage}</div>
      )}

      {rules.length > 0 && (
        <div className="space-y-2">
          {rules.map((rule, i) => (
            <RuleRow
              key={`${rule.scope}:${i}:${rule.tool}:${rule.pattern ?? ''}`}
              rule={rule}
              onEdit={() => {
                setEditIndex(i)
                setShowForm(true)
              }}
              onDelete={() => setDeleteIndex(i)}
            />
          ))}
        </div>
      )}

      <ConfirmModal
        isOpen={deleteIndex !== null}
        onClose={() => setDeleteIndex(null)}
        onConfirm={handleDelete}
        title="Delete rule?"
        message="This permission rule will be permanently removed."
        confirmLabel="Delete"
        confirmVariant="danger"
      />
    </>
  )
}
