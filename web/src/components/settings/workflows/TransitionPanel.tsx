import type { WorkflowStep, WorkflowCondition } from '../../../lib/workflows-actions'
import type { AgentInfo } from '../../../lib/agents-actions'
import { ArrowRightIcon, ChevronDownIcon } from '../../shared/icons'
import { CONDITION_TYPES } from './layout'
import { useT } from '../../../hooks/useT'

const inputClass =
  'w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary'
const selectClass =
  'w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary'
const labelClass = 'block text-[11px] text-text-secondary mb-0.5'

export function TransitionPanel({
  fromLabel,
  toLabel,
  condition,
  subGroup,
  fromStep,
  agentTypes,
  transitionIndex,
  totalTransitions,
  onUpdateCondition,
  onUpdateSubGroup,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  fromLabel: string
  toLabel: string
  condition: WorkflowCondition
  subGroup?: string
  fromStep?: WorkflowStep
  agentTypes: AgentInfo[]
  transitionIndex: number
  totalTransitions: number
  onUpdateCondition: (when: WorkflowCondition) => void
  onUpdateSubGroup: (subGroup: string | undefined) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const t = useT()
  const stepAgent =
    fromStep && (fromStep.type === 'sub_agent' || fromStep.type === 'agent')
      ? agentTypes.find((a) => a.id === (fromStep.type === 'sub_agent' ? fromStep.subAgentType : fromStep.agentId))
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
                title={t({ en: 'Move up (higher priority)', fr: 'Monter (priorité plus élevée)' })}
              >
                <ChevronDownIcon className="w-3 h-3" rotate={180} />
              </button>
              <button
                onClick={onMoveDown}
                disabled={transitionIndex === totalTransitions - 1}
                className="p-0.5 rounded text-text-muted hover:text-text-primary disabled:opacity-20 disabled:cursor-not-allowed"
                title={t({ en: 'Move down (lower priority)', fr: 'Descendre (priorité plus faible)' })}
              >
                <ChevronDownIcon className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
        <button onClick={onDelete} className="p-1 rounded text-text-muted hover:text-accent-error text-xs">
          {t({ en: 'Delete', fr: 'Supprimer' })}
        </button>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
        <span className="font-medium text-text-primary">{fromLabel}</span>
        <ArrowRightIcon />
        <span className="font-medium text-text-primary">{toLabel}</span>
      </div>

      <div>
        <label className={labelClass}>{t({ en: 'Condition', fr: 'Condition' })}</label>
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
          <label className={labelClass}>{t({ en: 'Result', fr: 'Résultat' })}</label>
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
            <label className={labelClass}>{t({ en: 'Metadata Key', fr: 'Clé de métadonnées' })}</label>
            <input
              type="text"
              value={condition.key ?? ''}
              onChange={(e) => onUpdateCondition({ ...condition, key: e.target.value })}
              placeholder="e.g. criteria, todos, review_findings"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t({ en: 'Field', fr: 'Champ' })}</label>
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
              <label className={labelClass}>{t({ en: 'Value', fr: 'Valeur' })}</label>
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
              <label className={labelClass}>
                {t({ en: 'Values (comma-separated)', fr: 'Valeurs (séparées par des virgules)' })}
              </label>
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

      <div>
        <label className={labelClass}>{t({ en: 'Sub-group', fr: 'Sous-groupe' })}</label>
        <input
          type="text"
          value={subGroup ?? ''}
          onChange={(e) => onUpdateSubGroup(e.target.value || undefined)}
          placeholder="e.g. build, verify"
          className={inputClass}
        />
      </div>

      {fromStep?.type === 'user' && (
        <div className="pt-1 border-t border-border/50 space-y-1">
          <p className="text-text-muted text-[10px]">
            {t({
              en: 'On a user step, each "Step result is..." transition becomes a choice button; "Always" becomes a Continue button.',
              fr: 'Sur une étape utilisateur, chaque transition « Le résultat de l’étape est... » devient un bouton de choix ; « Toujours » devient un bouton Continuer.',
            })}
          </p>
          {condition.type === 'step_result' &&
            fromStep.transitions.filter((t) => t.when.type === 'step_result' && t.when.result === condition.result)
              .length > 1 && (
              <p className="text-accent-warning text-[10px]">
                {t(
                  {
                    en: 'Duplicate result "{{result}}" — only the first matching transition is reachable.',
                    fr: 'Résultat « {{result}} » en double — seule la première transition correspondante est accessible.',
                  },
                  { result: condition.result ?? '' },
                )}
              </p>
            )}
          {condition.type === 'step_result' && condition.result === 'continue' && (
            <p className="text-accent-warning text-[10px]">
              {t({
                en: '"continue" is reserved for the "Always" Continue button — rename this result.',
                fr: '« continue » est réservé au bouton Continuer « Toujours » — renommez ce résultat.',
              })}
            </p>
          )}
          {condition.type === 'always' &&
            fromStep.transitions.some((t, i) => i > transitionIndex && t.when.type === 'step_result') && (
              <p className="text-accent-warning text-[10px]">
                {t({
                  en: 'This "Always" transition comes before one or more choice transitions — those choice buttons are unreachable. Move it to the end.',
                  fr: 'Cette transition « Toujours » précède une ou plusieurs transitions de choix — ces boutons de choix sont inaccessibles. Déplacez-la à la fin.',
                })}
              </p>
            )}
          {condition.type === 'always' && fromStep.transitions.filter((t) => t.when.type === 'always').length > 1 && (
            <p className="text-accent-warning text-[10px]">
              {t({
                en: 'Multiple "Always" transitions — only the first is reachable.',
                fr: 'Plusieurs transitions « Toujours » — seule la première est accessible.',
              })}
            </p>
          )}
        </div>
      )}

      <p className="text-text-muted text-[10px]">
        {t({
          en: 'Drag handles to reconnect. Order determines evaluation priority. Press Delete to remove.',
          fr: 'Faites glisser les poignées pour reconnecter. L’ordre détermine la priorité d’évaluation. Appuyez sur Supprimer pour retirer.',
        })}
      </p>
    </div>
  )
}
