import type { WorkflowStep, TemplateVariable, ParallelChildStep } from '../../../lib/workflows-actions'
import type { AgentInfo } from '../../../lib/agents-actions'
import { resolveAgent, STEP_TYPES } from './layout'
import { useT } from '../../../hooks/useT'

const inputClass =
  'w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary'
const selectClass =
  'w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary'
const labelClass = 'block text-[11px] text-text-secondary mb-0.5'

/** Slugify a child id so it stays addressable as a stepOutput key ([a-z0-9-]). */
function slugifyChildId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function TemplateVariablesHint({
  variables,
  onInsert,
}: {
  variables: TemplateVariable[]
  onInsert: (name: string) => void
}) {
  if (variables.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {variables.map((v) => (
        <button
          key={v.name}
          type="button"
          onClick={() => onInsert(v.name)}
          title={v.description}
          className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-bg-primary border border-border text-text-secondary hover:text-accent-primary hover:border-accent-primary/40 transition-colors"
        >
          {`{{${v.name}}}`}
        </button>
      ))}
    </div>
  )
}

function PromptField({
  value,
  rows,
  placeholder,
  variables,
  onValueChange,
  onInsert,
}: {
  value: string
  rows: number
  placeholder: string
  variables: TemplateVariable[]
  onValueChange: (value: string) => void
  onInsert: (name: string) => void
}) {
  const t = useT()
  return (
    <div>
      <label className={labelClass}>{t({ en: 'Prompt', fr: 'Invite' })}</label>
      <textarea
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        rows={rows}
        className={`${inputClass} resize-y text-xs`}
        placeholder={placeholder}
      />
      <TemplateVariablesHint variables={variables} onInsert={onInsert} />
    </div>
  )
}

function SubAgentTypeSelect({
  value,
  agentTypes,
  onChange,
}: {
  value: string
  agentTypes: AgentInfo[]
  onChange: (id: string) => void
}) {
  const t = useT()
  return (
    <div>
      <label className={labelClass}>{t({ en: 'Sub-Agent Type', fr: 'Type de sous-agent' })}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
        <option value="">{t({ en: '— select —', fr: '— sélectionner —' })}</option>
        {agentTypes
          .filter((a) => a.subagent)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
      </select>
    </div>
  )
}

function TimeoutField({ value, onChange }: { value: number; onChange: (ms: number) => void }) {
  const t = useT()
  return (
    <div>
      <label className={labelClass}>{t({ en: 'Timeout (ms)', fr: 'Délai (ms)' })}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`${inputClass} font-mono text-xs`}
      />
    </div>
  )
}

function SuccessCodesField({ value, onValueChange }: { value: number[]; onValueChange: (codes: number[]) => void }) {
  const t = useT()
  return (
    <div>
      <label className={labelClass}>{t({ en: 'Success Codes', fr: 'Codes de succès' })}</label>
      <input
        value={value.join(', ')}
        onChange={(e) =>
          onValueChange(
            e.target.value
              .split(',')
              .map((s) => Number(s.trim()))
              .filter((n) => !isNaN(n)),
          )
        }
        className={`${inputClass} font-mono text-xs`}
      />
    </div>
  )
}

export function StepPanel({
  step,
  isEntry,
  agentTypes,
  transitionCount,
  templateVariables,
  onUpdate,
  onRemove,
  onSetEntry,
}: {
  step: WorkflowStep
  isEntry: boolean
  agentTypes: AgentInfo[]
  transitionCount: number
  templateVariables: TemplateVariable[]
  onUpdate: (step: WorkflowStep) => void
  onRemove: () => void
  onSetEntry: () => void
}) {
  const t = useT()
  const { color, name: agentName } = resolveAgent(step, agentTypes)

  const updateChild = (index: number, patch: Partial<ParallelChildStep>) => {
    const children = [...(step.children ?? [])]
    const child = children[index]
    if (!child) return
    let next: ParallelChildStep = { ...child, ...patch }
    // Keep ids addressable: slugify a rename (spaces/special chars are not
    // valid stepOutput keys) and auto-suffix a collision with a sibling
    if (patch.id !== undefined && patch.id !== child.id) {
      const slugged = slugifyChildId(patch.id) || `child-${index + 1}`
      const siblingIds = children.filter((_, i) => i !== index).map((c) => c.id)
      let id = slugged
      if (siblingIds.includes(id)) {
        let n = 2
        id = `${slugged}-${n}`
        while (siblingIds.includes(id)) {
          n += 1
          id = `${slugged}-${n}`
        }
      }
      next = { ...next, id }
    }
    // A type switch drops the previous type's fields
    if (patch.type !== undefined && patch.type !== child.type) {
      next =
        patch.type === 'shell'
          ? { id: next.id, type: 'shell', command: next.command ?? '' }
          : { id: next.id, type: 'sub_agent', subAgentType: next.subAgentType ?? '' }
    }
    children[index] = next
    onUpdate({ ...step, children })
  }

  const removeChild = (index: number) => {
    onUpdate({ ...step, children: (step.children ?? []).filter((_, i) => i !== index) })
  }

  const addChild = () => {
    const children = [...(step.children ?? [])]
    const taken = new Set(children.map((c) => c.id))
    let n = 1
    let id = `child-${n}`
    while (taken.has(id)) {
      n += 1
      id = `child-${n}`
    }
    onUpdate({ ...step, children: [...children, { id, type: 'shell', command: '' }] })
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
            style={{ backgroundColor: color + '20', color }}
          >
            {agentName}
          </span>
          {isEntry && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent-primary/15 text-accent-primary">
              {t({ en: 'Entry', fr: 'Entrée' })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isEntry && (
            <button onClick={onSetEntry} className="p-1 rounded text-text-muted hover:text-accent-primary text-xs">
              {t({ en: 'Set entry', fr: 'Définir comme entrée' })}
            </button>
          )}
          <button onClick={onRemove} className="p-1 rounded text-text-muted hover:text-accent-error text-xs">
            {t({ en: 'Delete', fr: 'Supprimer' })}
          </button>
        </div>
      </div>

      <div>
        <label className={labelClass}>{t({ en: 'Name', fr: 'Nom' })}</label>
        <input
          value={step.name}
          onChange={(e) => onUpdate({ ...step, name: e.target.value })}
          placeholder={t({ en: 'Step name', fr: 'Nom de l’étape' })}
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>{t({ en: 'Type', fr: 'Type' })}</label>
        <select
          value={step.type}
          onChange={(e) => {
            const newType = e.target.value as WorkflowStep['type']
            const phase = newType === 'sub_agent' ? 'verification' : 'build'
            let next: WorkflowStep
            if (newType === 'agent') {
              const agent = agentTypes.find((a) => !a.subagent)
              next = {
                ...step,
                type: newType,
                phase,
                agentId: agent?.id ?? 'builder',
                name: agent?.name ?? t({ en: 'Agent', fr: 'Agent' }),
              }
            } else if (newType === 'sub_agent') {
              const agent = agentTypes.find((a) => a.subagent)
              next = {
                ...step,
                type: newType,
                phase,
                subAgentType: agent?.id ?? '',
                name: agent?.name ?? t({ en: 'Sub-Agent', fr: 'Sous-agent' }),
              }
            } else if (newType === 'user') {
              next = { ...step, type: newType, phase, name: t({ en: 'User', fr: 'Utilisateur' }) }
            } else if (newType === 'parallel') {
              next = {
                ...step,
                type: newType,
                phase,
                name: t({ en: 'Parallel', fr: 'Parallèle' }),
                children: step.children ?? [],
              }
              // Parallel owns only children + maxConcurrency — drop other types' fields
              delete next.agentId
              delete next.subAgentType
              delete next.prompt
              delete next.command
              delete next.timeout
              delete next.successExitCodes
            } else {
              next = { ...step, type: newType, phase, name: t({ en: 'Shell', fr: 'Shell' }) }
            }
            // Leaving parallel drops the parallel-only fields
            if (step.type === 'parallel' && newType !== 'parallel') {
              delete next.children
              delete next.maxConcurrency
            }
            onUpdate(next)
          }}
          className={selectClass}
        >
          {STEP_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {step.type === 'agent' && (
        <div>
          <label className={labelClass}>{t({ en: 'Agent Type', fr: 'Type d’agent' })}</label>
          <select
            value={step.agentId ?? 'builder'}
            onChange={(e) => {
              const agent = agentTypes.find((a) => a.id === e.target.value)
              onUpdate({
                ...step,
                agentId: e.target.value,
                name: agent?.name ?? e.target.value,
              })
            }}
            className={selectClass}
          >
            {agentTypes
              .filter((a) => !a.subagent)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </div>
      )}

      {step.type === 'sub_agent' && (
        <SubAgentTypeSelect
          value={step.subAgentType ?? ''}
          agentTypes={agentTypes}
          onChange={(id) => {
            const agent = agentTypes.find((a) => a.id === id)
            onUpdate({ ...step, subAgentType: id, name: agent?.name ?? id })
          }}
        />
      )}

      {(step.type === 'agent' || step.type === 'sub_agent') && (
        <>
          <PromptField
            value={step.prompt ?? ''}
            rows={6}
            placeholder={t({ en: 'Injected on first entry...', fr: 'Injecté à la première entrée...' })}
            variables={templateVariables}
            onValueChange={(v) => onUpdate({ ...step, prompt: v || undefined })}
            onInsert={(name) => onUpdate({ ...step, prompt: (step.prompt ?? '') + `{{${name}}}` })}
          />
          <div>
            <label className={labelClass}>{t({ en: 'Nudge Prompt', fr: 'Invite de relance' })}</label>
            <textarea
              value={step.nudgePrompt ?? ''}
              onChange={(e) => onUpdate({ ...step, nudgePrompt: e.target.value || undefined })}
              rows={6}
              className={`${inputClass} resize-y text-xs`}
              placeholder={t({ en: 'Injected on re-entry...', fr: 'Injecté à chaque ré-entrée...' })}
            />
            <TemplateVariablesHint
              variables={templateVariables}
              onInsert={(name) => onUpdate({ ...step, nudgePrompt: (step.nudgePrompt ?? '') + `{{${name}}}` })}
            />
          </div>
        </>
      )}

      {step.type === 'shell' && (
        <>
          <div>
            <label className={labelClass}>{t({ en: 'Command', fr: 'Commande' })}</label>
            <textarea
              value={step.command ?? ''}
              onChange={(e) => onUpdate({ ...step, command: e.target.value })}
              rows={3}
              className={`${inputClass} font-mono text-xs resize-y`}
              placeholder="cd {{workdir}} && npm run lint"
            />
            <TemplateVariablesHint
              variables={templateVariables}
              onInsert={(name) => onUpdate({ ...step, command: (step.command ?? '') + `{{${name}}}` })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TimeoutField value={step.timeout ?? 60000} onChange={(ms) => onUpdate({ ...step, timeout: ms })} />
            <SuccessCodesField
              value={step.successExitCodes ?? [0]}
              onValueChange={(codes) => onUpdate({ ...step, successExitCodes: codes })}
            />
          </div>
        </>
      )}

      {step.type === 'parallel' && (
        <div className="space-y-2">
          <div>
            <label className={labelClass}>{t({ en: 'Max concurrency', fr: 'Concurrence max' })}</label>
            <input
              type="number"
              value={step.maxConcurrency ?? ''}
              onChange={(e) =>
                onUpdate({
                  ...step,
                  maxConcurrency: e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
              placeholder={t({ en: 'all children', fr: 'tous les enfants' })}
              className={`${inputClass} font-mono text-xs`}
            />
          </div>

          {(step.children ?? []).map((child, index) => (
            <div key={`${child.id}-${index}`} className="border border-border/60 rounded p-2 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  value={child.id}
                  onChange={(e) => updateChild(index, { id: e.target.value })}
                  aria-label={t({ en: 'Child ID', fr: 'ID de l’étape enfant' })}
                  placeholder={t({ en: 'Child ID', fr: 'ID de l’étape enfant' })}
                  className={`${inputClass} font-mono text-xs flex-1`}
                />
                <select
                  value={child.type}
                  onChange={(e) => updateChild(index, { type: e.target.value as ParallelChildStep['type'] })}
                  className={`${selectClass} w-28`}
                >
                  <option value="sub_agent">{t({ en: 'Sub-Agent', fr: 'Sous-agent' })}</option>
                  <option value="shell">{t({ en: 'Shell', fr: 'Shell' })}</option>
                </select>
                <button
                  onClick={() => removeChild(index)}
                  className="p-1 rounded text-text-muted hover:text-accent-error text-xs"
                >
                  {t({ en: 'Delete', fr: 'Supprimer' })}
                </button>
              </div>

              {child.type === 'sub_agent' && (
                <>
                  <SubAgentTypeSelect
                    value={child.subAgentType ?? ''}
                    agentTypes={agentTypes}
                    onChange={(id) => updateChild(index, { subAgentType: id })}
                  />
                  <PromptField
                    value={child.prompt ?? ''}
                    rows={3}
                    placeholder={t({ en: 'Child prompt…', fr: 'Invite de l’étape enfant…' })}
                    variables={templateVariables}
                    onValueChange={(v) => updateChild(index, { prompt: v || undefined })}
                    onInsert={(name) => updateChild(index, { prompt: (child.prompt ?? '') + `{{${name}}}` })}
                  />
                </>
              )}

              {child.type === 'shell' && (
                <>
                  <div>
                    <label className={labelClass}>{t({ en: 'Command', fr: 'Commande' })}</label>
                    <textarea
                      value={child.command ?? ''}
                      onChange={(e) => updateChild(index, { command: e.target.value })}
                      rows={2}
                      className={`${inputClass} font-mono text-xs resize-y`}
                      placeholder={t({ en: 'npm run lint', fr: 'npm run lint' })}
                    />
                    <TemplateVariablesHint
                      variables={templateVariables}
                      onInsert={(name) => updateChild(index, { command: (child.command ?? '') + `{{${name}}}` })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <TimeoutField
                      value={child.timeout ?? 60000}
                      onChange={(ms) => updateChild(index, { timeout: ms })}
                    />
                    <SuccessCodesField
                      value={child.successExitCodes ?? [0]}
                      onValueChange={(codes) => updateChild(index, { successExitCodes: codes })}
                    />
                  </div>
                </>
              )}
            </div>
          ))}

          <button
            onClick={addChild}
            className="w-full px-2 py-1 rounded text-xs border border-dashed border-border text-text-secondary hover:text-accent-primary hover:border-accent-primary/40"
          >
            {t({ en: 'Add child step', fr: 'Ajouter une étape enfant' })}
          </button>
        </div>
      )}

      <div>
        <label className={labelClass}>{t({ en: 'Sub-group', fr: 'Sous-groupe' })}</label>
        <input
          value={step.subGroup ?? ''}
          onChange={(e) => onUpdate({ ...step, subGroup: e.target.value || undefined })}
          placeholder="e.g. build, verify, review"
          className={inputClass}
        />
      </div>

      <div className="pt-1 border-t border-border/50">
        <p className="text-text-muted text-[10px]">
          {t(
            {
              en: {
                one: '{{count}} outgoing transition — drag from the bottom port to connect.',
                other: '{{count}} outgoing transitions — drag from the bottom port to connect.',
              },
              fr: {
                one: '{{count}} transition sortante — faites glisser depuis le port du bas pour connecter.',
                other: '{{count}} transitions sortantes — faites glisser depuis le port du bas pour connecter.',
              },
            },
            { count: transitionCount },
          )}
        </p>
      </div>
    </div>
  )
}
