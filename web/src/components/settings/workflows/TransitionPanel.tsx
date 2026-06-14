import type { WorkflowStep, WorkflowCondition } from '../../../stores/workflows'
import type { AgentInfo } from '../../../stores/agents'
import { ArrowRightIcon, ChevronDownIcon } from '../../shared/icons'
import { CONDITION_TYPES } from './layout'

const inputClass =
  'w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary'
const selectClass =
  'w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary'
const labelClass = 'block text-[11px] text-text-secondary mb-0.5'

export function TransitionPanel({
  fromLabel,
  toLabel,
  condition,
  fromStep,
  agentTypes,
  transitionIndex,
  totalTransitions,
  onUpdateCondition,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  fromLabel: string
  toLabel: string
  condition: WorkflowCondition
  fromStep?: WorkflowStep
  agentTypes: AgentInfo[]
  transitionIndex: number
  totalTransitions: number
  onUpdateCondition: (when: WorkflowCondition) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const stepAgent =
    fromStep && (fromStep.type === 'sub_agent' || fromStep.type === 'agent')
      ? agentTypes.find((a) => a.id === (fromStep.type === 'sub_agent' ? fromStep.subAgentType : fromStep.toolMode))
      : undefined
  const hasResults = stepAgent?.results && stepAgent.results.length > 0

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/15 text-blue-300">
            #{transitionIndex + 1}
          </span>
          {totalTransitions > 1 && (
            <div className="flex items-center gap-0.5">
              <button
                onClick={onMoveUp}
                disabled={transitionIndex === 0}
                className="p-0.5 rounded text-text-muted hover:text-text-primary disabled:opacity-20 disabled:cursor-not-allowed"
                title="Move up (higher priority)"
              >
                <ChevronDownIcon className="w-3 h-3" rotate={180} />
              </button>
              <button
                onClick={onMoveDown}
                disabled={transitionIndex === totalTransitions - 1}
                className="p-0.5 rounded text-text-muted hover:text-text-primary disabled:opacity-20 disabled:cursor-not-allowed"
                title="Move down (lower priority)"
              >
                <ChevronDownIcon className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
        <button onClick={onDelete} className="p-1 rounded text-text-muted hover:text-accent-error text-xs">
          Delete
        </button>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
        <span className="font-medium text-text-primary">{fromLabel}</span>
        <ArrowRightIcon />
        <span className="font-medium text-text-primary">{toLabel}</span>
      </div>

      <div>
        <label className={labelClass}>Condition</label>
        <select
          value={condition.type}
          onChange={(e) => {
            onUpdateCondition(
              e.target.value === 'step_result' ? { type: 'step_result', result: 'success' } : { type: e.target.value },
            )
          }}
          className={selectClass}
        >
          {CONDITION_TYPES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {condition.type === 'step_result' && (
        <div>
          <label className={labelClass}>Result</label>
          {hasResults ? (
            <select
              value={condition.result ?? stepAgent!.results![0]}
              onChange={(e) => {
                onUpdateCondition({ type: 'step_result', result: e.target.value })
              }}
              className={selectClass}
            >
              {stepAgent!.results!.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={condition.result ?? 'success'}
              onChange={(e) => onUpdateCondition({ type: 'step_result', result: e.target.value })}
              placeholder="e.g. success, passed, failed"
              className={inputClass}
            />
          )}
        </div>
      )}

      {(condition.type === 'metadata_all_match' || condition.type === 'metadata_all_in') && (
        <>
          <div>
            <label className={labelClass}>Metadata Key</label>
            <input
              type="text"
              value={condition.key ?? ''}
              onChange={(e) => onUpdateCondition({ ...condition, key: e.target.value })}
              placeholder="e.g. criteria, todos, review_findings"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Field</label>
            <input
              type="text"
              value={condition.field ?? ''}
              onChange={(e) => onUpdateCondition({ ...condition, field: e.target.value })}
              placeholder="e.g. status"
              className={inputClass}
            />
          </div>
          {condition.type === 'metadata_all_match' ? (
            <div>
              <label className={labelClass}>Value</label>
              <input
                type="text"
                value={condition.value ?? ''}
                onChange={(e) => onUpdateCondition({ ...condition, value: e.target.value })}
                placeholder="e.g. passed, resolved"
                className={inputClass}
              />
            </div>
          ) : (
            <div>
              <label className={labelClass}>Values (comma-separated)</label>
              <input
                type="text"
                value={condition.values?.join(', ') ?? ''}
                onChange={(e) =>
                  onUpdateCondition({
                    ...condition,
                    values: e.target.value
                      .split(',')
                      .map((v) => v.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="e.g. resolved, dismissed"
                className={inputClass}
              />
            </div>
          )}
        </>
      )}

      <p className="text-text-muted text-[10px]">
        Drag handles to reconnect. Order determines evaluation priority. Press Delete to remove.
      </p>
    </div>
  )
}
