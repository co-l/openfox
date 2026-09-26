import { useState, useEffect } from 'react'
import { PATTERN_TOOLS, isCommandTool, isDefaultRule, isPatternTool } from '@shared/permissions.js'
import type { PermissionEffect, PermissionRule, PermissionScope, ScopedPermissionRule } from '@shared/permissions.js'
import { authFetch } from '../../lib/api'
import { useT } from '../../hooks/useT'
import { Button } from '../shared/Button'
import { ConfirmModal } from '../shared/ConfirmModal'
import { EditSmallIcon, TrashIcon } from '../shared/icons'

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

/** Search (tool, pattern, description) + effect filter, split into user rules and shipped defaults. */
export function filterRules(
  rules: ScopedPermissionRule[],
  query: string,
  effects: PermissionEffect[],
): { mine: ScopedPermissionRule[]; defaults: ScopedPermissionRule[] } {
  const needle = query.trim().toLowerCase()
  const kept = rules.filter(
    (rule) =>
      (effects.length === 0 || effects.includes(rule.effect)) &&
      (!needle || [rule.tool, rule.pattern, rule.description].some((field) => field?.toLowerCase().includes(needle))),
  )
  return { mine: kept.filter((rule) => !isDefaultRule(rule)), defaults: kept.filter(isDefaultRule) }
}

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
  const t = useT()
  const [effect, setEffect] = useState<PermissionEffect>(initial?.effect ?? 'DENY')
  const [tool, setTool] = useState(initial?.tool ?? 'read_file')
  const [pattern, setPattern] = useState(initial?.pattern ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [scope, setScope] = useState<PermissionScope>(!allowProject ? 'global' : (initialScope ?? 'project'))
  const [tools, setTools] = useState<string[]>([...PATTERN_TOOLS])

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

  const isCommand = isCommandTool(tool)
  const isPattern = isPatternTool(tool)
  const allowedEffects: PermissionEffect[] = isPattern ? EFFECTS : ['DENY']

  return (
    <div className="space-y-3 p-3 border border-border rounded-lg bg-bg-tertiary">
      <div className={hideScope ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-3 gap-3'}>
        <div>
          <label className="text-xs text-text-muted block mb-1">{t({ en: 'Effect', fr: 'Effet' })}</label>
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
          <label className="text-xs text-text-muted block mb-1">{t({ en: 'Tool', fr: 'Outil' })}</label>
          <select
            value={tool}
            onChange={(e) => {
              const newTool = e.target.value
              setTool(newTool)
              if (!isPatternTool(newTool)) {
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
            <label className="text-xs text-text-muted block mb-1">{t({ en: 'Scope', fr: 'Portée' })}</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as PermissionScope)}
              className="w-full px-2 py-1 text-sm text-text-primary bg-bg-primary border border-border rounded"
            >
              <option value="project" disabled={!allowProject}>
                {allowProject
                  ? t({ en: 'Project', fr: 'Projet' })
                  : t({ en: 'Project (no active session)', fr: 'Projet (aucune session active)' })}
              </option>
              <option value="global">{t({ en: 'Global', fr: 'Global' })}</option>
            </select>
          </div>
        )}
      </div>
      <div>
        <label className="text-xs text-text-muted block mb-1">
          {t({ en: 'Pattern', fr: 'Motif' })}{' '}
          <span className="text-text-muted/60">
            {!isPattern
              ? t({
                  en: '(not applicable — this tool has no path/command target)',
                  fr: '(non applicable — cet outil n’a pas de cible chemin/commande)',
                })
              : isCommand
                ? t({
                    en: '(optional, glob: `*` matches anything)',
                    fr: '(optionnel, glob : `*` correspond à tout)',
                  })
                : t({
                    en: '(optional, glob: `**` for any depth, `*` for one segment)',
                    fr: '(optionnel, glob : `**` pour toute profondeur, `*` pour un segment)',
                  })}
          </span>
        </label>
        <input
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          disabled={!isPattern}
          placeholder={
            isCommand
              ? 'terragrunt destroy *'
              : isPattern
                ? t({ en: '/path/** or **/.env*', fr: '/chemin/** ou **/.env*' })
                : t({ en: 'N/A', fr: 'N/A' })
          }
          className="w-full px-2 py-1 text-sm font-mono text-text-primary bg-bg-primary border border-border rounded disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>
      <div>
        <label className="text-xs text-text-muted block mb-1">
          {t({ en: 'Description (optional)', fr: 'Description (optionnelle)' })}
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t({ en: 'Why this rule exists', fr: 'Pourquoi cette règle existe' })}
          className="w-full px-2 py-1 text-sm text-text-primary bg-bg-primary border border-border rounded"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
          {t({ en: 'Cancel', fr: 'Annuler' })}
        </Button>
        <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? t({ en: 'Saving…', fr: 'Enregistrement…' }) : t({ en: 'Save', fr: 'Enregistrer' })}
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
  const t = useT()
  return (
    <div className="flex items-center gap-3 p-2 border border-border rounded">
      <EffectBadge effect={rule.effect} />
      <ScopeBadge scope={rule.scope} />
      <span className="text-sm text-text-primary">{rule.tool}</span>
      {rule.pattern && <span className="text-xs font-mono text-text-muted flex-1 truncate">{rule.pattern}</span>}
      {!rule.pattern && (
        <span className="text-xs text-text-muted/60 flex-1 italic">
          {t({ en: '(all calls)', fr: '(tous les appels)' })}
        </span>
      )}
      {rule.description && (
        <span className="text-xs text-text-muted/80 truncate max-w-[200px]" title={rule.description}>
          — {rule.description}
        </span>
      )}
      <div className="flex gap-1 ml-auto">
        <button
          onClick={onEdit}
          title={t({ en: 'Edit', fr: 'Modifier' })}
          className="p-1 text-text-muted hover:text-text-primary"
        >
          <EditSmallIcon className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onDelete}
          title={t({ en: 'Delete', fr: 'Supprimer' })}
          className="p-1 text-text-muted hover:text-red-400"
        >
          <TrashIcon className="w-3.5 h-3.5" />
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
  emptyMessage,
  hideScope = false,
  allowProject = true,
}: {
  rules: ScopedPermissionRule[]
  saving: boolean
  onAdd: (rule: PermissionRule, scope: PermissionScope) => Promise<void>
  onUpdate: (id: string, rule: PermissionRule, scope: PermissionScope) => Promise<void>
  onDelete: (id: string, scope: PermissionScope) => Promise<void>
  emptyMessage?: string
  hideScope?: boolean
  allowProject?: boolean
}) {
  const t = useT()
  const [showForm, setShowForm] = useState(false)
  // Rules are addressed by id, never by their position in the merged list: the
  // list mixes global and project scopes and re-sorts whenever either reloads.
  const [editId, setEditId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const editRule = editId !== null ? rules.find((rule) => rule.id === editId) : undefined
  const [query, setQuery] = useState('')
  const [effects, setEffects] = useState<PermissionEffect[]>([])
  // null = not toggled yet: open the defaults when they are all there is, so the filters never sit above an empty list
  const [showDefaults, setShowDefaults] = useState<boolean | null>(null)
  const filtering = query.trim() !== '' || effects.length > 0
  const { mine, defaults } = filterRules(rules, query, effects)
  // Defaults stay folded unless the user is looking for something.
  const showAllDefaults = (showDefaults ?? rules.every(isDefaultRule)) || filtering

  const renderRow = (rule: ScopedPermissionRule) => (
    <RuleRow
      key={`${rule.scope}:${rule.id}`}
      rule={rule}
      onEdit={() => {
        setEditId(rule.id)
        setShowForm(true)
      }}
      onDelete={() => setDeleteId(rule.id)}
    />
  )

  const handleSave = async (rule: PermissionRule, scope: PermissionScope) => {
    if (editId !== null) {
      await onUpdate(editId, rule, scope)
    } else {
      await onAdd(rule, scope)
    }
    setShowForm(false)
    setEditId(null)
  }

  const handleDelete = async () => {
    if (deleteId === null) return
    const rule = rules.find((candidate) => candidate.id === deleteId)
    if (rule) await onDelete(deleteId, rule.scope)
    setDeleteId(null)
  }

  return (
    <>
      {showForm ? (
        <RuleForm
          initial={editRule}
          initialScope={editRule?.scope}
          onSave={handleSave}
          onCancel={() => {
            setShowForm(false)
            setEditId(null)
          }}
          saving={saving}
          hideScope={hideScope || editId !== null}
          allowProject={allowProject}
        />
      ) : (
        <Button variant="primary" size="sm" onClick={() => setShowForm(true)} disabled={saving}>
          {saving ? t({ en: 'Saving…', fr: 'Enregistrement…' }) : t({ en: '+ Add Rule', fr: '+ Ajouter une règle' })}
        </Button>
      )}

      {rules.length === 0 && !showForm && (
        <div className="text-sm text-text-muted py-4 text-center border border-border rounded">
          {emptyMessage ??
            t({
              en: 'No permission rules. Add one to allow/deny tool actions without prompts.',
              fr: 'Aucune règle de permission. Ajoutez-en une pour autoriser/refuser des actions d’outil sans confirmation.',
            })}
        </div>
      )}

      {rules.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t({ en: 'Search tool, pattern, description…', fr: 'Rechercher outil, motif, description…' })}
              className="flex-1 min-w-40 px-2 py-1 text-sm bg-bg-tertiary border border-border rounded text-text-primary"
            />
            {EFFECTS.map((effect) => {
              const active = effects.includes(effect)
              return (
                <button
                  key={effect}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setEffects((current) => (active ? current.filter((e) => e !== effect) : [...current, effect]))
                  }
                  className={`text-xs font-medium px-2 py-0.5 rounded border ${
                    active ? EFFECT_COLORS[effect] : 'text-text-muted border-border'
                  }`}
                >
                  {effect}
                </button>
              )
            })}
          </div>

          {mine.length > 0 && <div className="space-y-2">{mine.map(renderRow)}</div>}

          {defaults.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowDefaults(!showAllDefaults)}
                className="text-xs text-text-muted hover:text-text-secondary"
              >
                {t(
                  showAllDefaults
                    ? { en: '▾ Default rules ({{count}})', fr: '▾ Règles par défaut ({{count}})' }
                    : { en: '▸ Default rules ({{count}})', fr: '▸ Règles par défaut ({{count}})' },
                  { count: String(defaults.length) },
                )}
              </button>
              {showAllDefaults && defaults.map(renderRow)}
            </div>
          )}

          {filtering && mine.length === 0 && defaults.length === 0 && (
            <div className="text-sm text-text-muted py-4 text-center border border-border rounded">
              {t({ en: 'No rule matches these filters.', fr: 'Aucune règle ne correspond à ces filtres.' })}
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title={t({ en: 'Delete rule?', fr: 'Supprimer la règle ?' })}
        message={t({
          en: 'This permission rule will be permanently removed.',
          fr: 'Cette règle de permission sera définitivement supprimée.',
        })}
        confirmLabel={t({ en: 'Delete', fr: 'Supprimer' })}
        confirmVariant="danger"
      />
    </>
  )
}
