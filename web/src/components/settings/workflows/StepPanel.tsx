import type { WorkflowStep, TemplateVariable } from '../../../lib/workflows-actions'
import type { AgentInfo } from '../../../lib/agents-actions'
import type { Provider } from '../../../stores/config'
import { resolveAgent, STEP_TYPES } from './layout'
import { ModelPicker } from '../../shared/ModelPicker'
import { useT } from '../../../hooks/useT'

const inputClass =
  'w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary'
const selectClass =
  'w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary'
const labelClass = 'block text-[11px] text-text-secondary mb-0.5'

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

export function StepPanel({
  step,
  isEntry,
  agentTypes,
  providers = [],
  transitionCount,
  templateVariables,
  onUpdate,
  onRemove,
  onSetEntry,
}: {
  step: WorkflowStep
  isEntry: boolean
  agentTypes: AgentInfo[]
  providers?: Provider[]
  transitionCount: number
  templateVariables: TemplateVariable[]
  onUpdate: (step: WorkflowStep) => void
  onRemove: () => void
  onSetEntry: () => void
}) {
  const t = useT()
  const { color, name: agentName } = resolveAgent(step, agentTypes)

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
            if (newType === 'agent') {
              const agent = agentTypes.find((a) => !a.subagent)
              onUpdate({
                ...step,
                type: newType,
                phase,
                agentId: agent?.id ?? 'builder',
                name: agent?.name ?? t({ en: 'Agent', fr: 'Agent' }),
              })
            } else if (newType === 'sub_agent') {
              const agent = agentTypes.find((a) => a.subagent)
              onUpdate({
                ...step,
                type: newType,
                phase,
                subAgentType: agent?.id ?? '',
                name: agent?.name ?? t({ en: 'Sub-Agent', fr: 'Sous-agent' }),
              })
            } else if (newType === 'user') {
              onUpdate({ ...step, type: newType, phase, name: t({ en: 'User', fr: 'Utilisateur' }) })
            } else {
              onUpdate({ ...step, type: newType, phase, name: t({ en: 'Shell', fr: 'Shell' }) })
            }
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
        <div>
          <label className={labelClass}>{t({ en: 'Sub-Agent Type', fr: 'Type de sous-agent' })}</label>
          <select
            value={step.subAgentType ?? ''}
            onChange={(e) => {
              const agent = agentTypes.find((a) => a.id === e.target.value)
              onUpdate({ ...step, subAgentType: e.target.value, name: agent?.name ?? e.target.value })
            }}
            className={selectClass}
          >
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
      )}

      {(step.type === 'agent' || step.type === 'sub_agent') && (
        <div>
          <label className={labelClass}>{t({ en: 'Model override', fr: 'Remplacement du modèle' })}</label>
          <ModelPicker
            providers={providers}
            value={step.model}
            onChange={(v) => onUpdate({ ...step, model: v || undefined })}
            defaultLabel={t({ en: 'Default (global model)', fr: 'Défaut (modèle global)' })}
          />
        </div>
      )}

      {(step.type === 'agent' || step.type === 'sub_agent') && (
        <>
          <div>
            <label className={labelClass}>{t({ en: 'Prompt', fr: 'Invite' })}</label>
            <textarea
              value={step.prompt ?? ''}
              onChange={(e) => onUpdate({ ...step, prompt: e.target.value || undefined })}
              rows={6}
              className={`${inputClass} resize-y text-xs`}
              placeholder={t({ en: 'Injected on first entry...', fr: 'Injecté à la première entrée...' })}
            />
            <TemplateVariablesHint
              variables={templateVariables}
              onInsert={(name) => onUpdate({ ...step, prompt: (step.prompt ?? '') + `{{${name}}}` })}
            />
          </div>
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
            <div>
              <label className={labelClass}>{t({ en: 'Timeout (ms)', fr: 'Délai (ms)' })}</label>
              <input
                type="number"
                value={step.timeout ?? 60000}
                onChange={(e) => onUpdate({ ...step, timeout: Number(e.target.value) })}
                className={`${inputClass} font-mono text-xs`}
              />
            </div>
            <div>
              <label className={labelClass}>{t({ en: 'Success Codes', fr: 'Codes de succès' })}</label>
              <input
                value={(step.successExitCodes ?? [0]).join(', ')}
                onChange={(e) =>
                  onUpdate({
                    ...step,
                    successExitCodes: e.target.value
                      .split(',')
                      .map((s) => Number(s.trim()))
                      .filter((n) => !isNaN(n)),
                  })
                }
                className={`${inputClass} font-mono text-xs`}
              />
            </div>
          </div>
        </>
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
