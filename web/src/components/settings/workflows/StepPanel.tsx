import type { WorkflowStep, TemplateVariable } from '../../../stores/workflows'
import type { AgentInfo } from '../../../stores/agents'
import { resolveAgent, STEP_TYPES } from './layout'

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
              Entry
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isEntry && (
            <button onClick={onSetEntry} className="p-1 rounded text-text-muted hover:text-accent-primary text-xs">
              Set entry
            </button>
          )}
          <button onClick={onRemove} className="p-1 rounded text-text-muted hover:text-accent-error text-xs">
            Delete
          </button>
        </div>
      </div>

      <div>
        <label className={labelClass}>Type</label>
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
                toolMode: (agent?.id ?? 'builder') as 'builder' | 'planner',
                name: agent?.name ?? 'Agent',
              })
            } else if (newType === 'sub_agent') {
              const agent = agentTypes.find((a) => a.subagent)
              onUpdate({
                ...step,
                type: newType,
                phase,
                subAgentType: agent?.id ?? '',
                name: agent?.name ?? 'Sub-Agent',
              })
            } else {
              onUpdate({ ...step, type: newType, phase, name: 'Shell' })
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
          <label className={labelClass}>Agent Type</label>
          <select
            value={step.toolMode ?? 'builder'}
            onChange={(e) => {
              const agent = agentTypes.find((a) => a.id === e.target.value)
              onUpdate({
                ...step,
                toolMode: e.target.value as 'builder' | 'planner',
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
          <label className={labelClass}>Sub-Agent Type</label>
          <select
            value={step.subAgentType ?? ''}
            onChange={(e) => {
              const agent = agentTypes.find((a) => a.id === e.target.value)
              onUpdate({ ...step, subAgentType: e.target.value, name: agent?.name ?? e.target.value })
            }}
            className={selectClass}
          >
            <option value="">— select —</option>
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
        <>
          <div>
            <label className={labelClass}>Prompt</label>
            <textarea
              value={step.prompt ?? ''}
              onChange={(e) => onUpdate({ ...step, prompt: e.target.value || undefined })}
              rows={6}
              className={`${inputClass} resize-y text-xs`}
              placeholder="Injected on first entry..."
            />
            <TemplateVariablesHint
              variables={templateVariables}
              onInsert={(name) => onUpdate({ ...step, prompt: (step.prompt ?? '') + `{{${name}}}` })}
            />
          </div>
          <div>
            <label className={labelClass}>Nudge Prompt</label>
            <textarea
              value={step.nudgePrompt ?? ''}
              onChange={(e) => onUpdate({ ...step, nudgePrompt: e.target.value || undefined })}
              rows={6}
              className={`${inputClass} resize-y text-xs`}
              placeholder="Injected on re-entry..."
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
            <label className={labelClass}>Command</label>
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
              <label className={labelClass}>Timeout (ms)</label>
              <input
                type="number"
                value={step.timeout ?? 60000}
                onChange={(e) => onUpdate({ ...step, timeout: Number(e.target.value) })}
                className={`${inputClass} font-mono text-xs`}
              />
            </div>
            <div>
              <label className={labelClass}>Success Codes</label>
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
        <label className={labelClass}>Sub-group</label>
        <input
          value={step.subGroup ?? ''}
          onChange={(e) => onUpdate({ ...step, subGroup: e.target.value || undefined })}
          placeholder="e.g. build, verify, review"
          className={inputClass}
        />
      </div>

      <div className="pt-1 border-t border-border/50">
        <p className="text-text-muted text-[10px]">
          {transitionCount} outgoing transition{transitionCount !== 1 ? 's' : ''} — drag from the bottom port to
          connect.
        </p>
      </div>
    </div>
  )
}
