import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Modal } from '../shared/SelfContainedModal'
import { useT } from '../../hooks/useT'

export type EffortGateChoice = 'apply' | 'keep'

export interface EffortGateInfo {
  /** Effort currently in effect (what would be kept). */
  fromEffort?: string
  /** Effort the transition would apply. */
  toEffort: string
  /** Optional label of the transition target (e.g. an agent or workflow name). */
  contextLabel?: string
}

interface EffortChangeGateContextValue {
  requestEffortSwitch: (info: EffortGateInfo) => Promise<EffortGateChoice>
}

const EffortChangeGateContext = createContext<EffortChangeGateContextValue | null>(null)

interface Pending {
  info: EffortGateInfo
  resolve: (choice: EffortGateChoice) => void
}

export function EffortChangeGateProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const [pending, setPending] = useState<Pending | null>(null)

  const requestEffortSwitch = useCallback(
    (info: EffortGateInfo) =>
      new Promise<EffortGateChoice>((resolve) => {
        setPending({ info, resolve })
      }),
    [],
  )

  const choose = useCallback((choice: EffortGateChoice) => {
    setPending((current) => {
      current?.resolve(choice)
      return null
    })
  }, [])

  const value = useMemo(() => ({ requestEffortSwitch }), [requestEffortSwitch])

  return (
    <EffortChangeGateContext.Provider value={value}>
      {children}
      {pending && (
        <Modal
          isOpen={true}
          onClose={() => choose('keep')}
          title={t({ en: 'Reasoning effort change', fr: 'Changement d’effort de raisonnement' })}
          size="sm"
        >
          <p className="text-sm text-text-secondary">
            {pending.info.contextLabel ? (
              <>
                <span className="text-text-primary font-medium">{pending.info.contextLabel}</span>{' '}
                {t({ en: 'runs with reasoning effort', fr: 's’exécute avec un effort de raisonnement' })}{' '}
                <code className="text-accent-primary">{pending.info.toEffort}</code>
                {currentEffortClause(pending.info, t)}.
              </>
            ) : (
              <>
                {t({ en: 'Switching the reasoning effort to', fr: 'Passage de l’effort de raisonnement à' })}{' '}
                <code className="text-accent-primary">{pending.info.toEffort}</code>
                {currentEffortClause(pending.info, t)}.
              </>
            )}{' '}
            {t({
              en: 'This may invalidate the LLM prefix cache — if it does, the next response will take longer while the context is reprocessed.',
              fr: 'Cela peut invalider le cache de préfixe du LLM — si c’est le cas, la prochaine réponse prendra plus de temps pendant que le contexte est retraité.',
            })}
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <ModalButton onClick={() => choose('keep')} variant="secondary">
              {t({ en: 'Keep current reasoning effort', fr: 'Conserver l’effort de raisonnement actuel' })}
            </ModalButton>
            <ModalButton onClick={() => choose('apply')} variant="danger">
              {t({
                en: 'Apply the reasoning effort (invalidates cache)',
                fr: 'Appliquer l’effort de raisonnement (invalide le cache)',
              })}
            </ModalButton>
          </div>
        </Modal>
      )}
    </EffortChangeGateContext.Provider>
  )
}

function ModalButton({
  onClick,
  variant,
  children,
}: {
  onClick: () => void
  variant: 'primary' | 'secondary' | 'danger'
  children: ReactNode
}) {
  const className =
    variant === 'primary'
      ? 'px-3 py-1.5 text-sm rounded bg-accent-primary text-white hover:opacity-90 transition-colors'
      : variant === 'danger'
        ? 'px-3 py-1.5 text-sm rounded bg-accent-error text-white hover:opacity-90 transition-colors'
        : 'px-3 py-1.5 text-sm rounded bg-bg-tertiary text-text-primary hover:bg-border transition-colors'
  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  )
}

function currentEffortClause(
  info: EffortGateInfo,
  t: (tx: { en: string | Record<string, string>; fr: string | Record<string, string> }) => string,
): ReactNode {
  if (!info.fromEffort || info.fromEffort === info.toEffort) return null
  return (
    <>
      {' '}
      {t({ en: '(currently', fr: '(actuellement' })} <code className="text-text-primary">{info.fromEffort}</code>
      {')'}
    </>
  )
}

export function useEffortChangeGate(): EffortChangeGateContextValue {
  const ctx = useContext(EffortChangeGateContext)
  if (!ctx) {
    throw new Error('useEffortChangeGate must be used within EffortChangeGateProvider')
  }
  return ctx
}
