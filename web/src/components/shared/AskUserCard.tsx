import { useState, useRef, useEffect, useCallback } from 'react'
import type { ToolCall } from '@shared/types.js'
import { normalizeAskOptions } from '@shared/ask-options.js'
import { useSessionStore, usePendingQuestions, type PendingQuestion } from '../../stores/session'
import { shouldAutofocus } from '../../lib/device'
import { useSessionScope } from '../../stores/session/session-scope'
import { Markdown } from './Markdown'
import { RECOMMENDED_CLASS, RecommendedCountdown } from './RecommendedCountdown'
import { useT } from '../../hooks/useT'

interface AskUserCardProps {
  toolCall: ToolCall
}

export function AskUserCard({ toolCall }: AskUserCardProps) {
  const t = useT()
  const sessionId = useSessionScope()
  const pendingQuestions = usePendingQuestions(sessionId)
  const answerQuestion = useSessionStore((state) => state.answerQuestion)
  const cancelAutoAnswers = useSessionStore((state) => state.cancelAutoAnswers)
  const [answer, setAnswer] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const pendingQuestion: PendingQuestion | undefined = pendingQuestions.find((q) => q.callId === toolCall.id)

  const question = (toolCall.arguments['question'] as string | undefined) ?? pendingQuestion?.question ?? ''
  const type =
    (toolCall.arguments['type'] as 'text' | 'confirm' | 'choice' | undefined) ?? pendingQuestion?.type ?? 'text'
  // LLM outputs sometimes arrive as `string[]`, sometimes as a string ("A, B"),
  // sometimes as `[{label, description}]` objects (LLM quirk, see issue #31).
  // We accept all three: coerce + drop malformed entries. We never render an
  // object directly as a React child (that crashes React).
  const rawOptions: unknown = (toolCall.arguments['options'] as unknown) ?? pendingQuestion?.options ?? undefined
  const choiceOptions = normalizeAskOptions(rawOptions)

  const hasResult = toolCall.result !== undefined
  const isPending = pendingQuestion !== undefined && !hasResult

  const resultText = toolCall.result?.output ?? ''
  const isSkipped = resultText === '[user skipped]'
  const wasAutoAnswered = toolCall.result?.metadata?.['autoAnswered'] === true

  useEffect(() => {
    if (isPending && shouldAutofocus() && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isPending])

  useEffect(() => {
    if (isPending && containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isPending])

  const handleSubmit = useCallback(() => {
    if (!pendingQuestion || !sessionId) return
    answerQuestion(sessionId, pendingQuestion.callId, answer)
  }, [pendingQuestion, answer, answerQuestion, sessionId])

  const handleSkip = useCallback(() => {
    if (!pendingQuestion || !sessionId) return
    answerQuestion(sessionId, pendingQuestion.callId, '', true)
  }, [pendingQuestion, answerQuestion, sessionId])

  const cancelCountdown = useCallback(() => {
    if (sessionId) cancelAutoAnswers(sessionId)
  }, [sessionId, cancelAutoAnswers])

  // Typing an answer inside the question card also takes over from the countdown.
  const handleAnswerChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setAnswer(e.target.value)
      if (pendingQuestion?.autoAnswerDeadline !== undefined && sessionId) cancelAutoAnswers(sessionId)
    },
    [pendingQuestion, sessionId, cancelAutoAnswers],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
      if (e.key === 'Escape' && !e.shiftKey) {
        e.preventDefault()
        handleSkip()
      }
    },
    [handleSubmit, handleSkip],
  )

  const handleOptionSelect = useCallback(
    (option: string) => {
      if (!pendingQuestion || !sessionId) return
      answerQuestion(sessionId, pendingQuestion.callId, option)
    },
    [pendingQuestion, answerQuestion, sessionId],
  )

  const btnBase = 'px-3 py-1.5 text-xs font-medium rounded transition-colors'
  const hasAutoAnswer = pendingQuestion?.autoAnswerDeadline !== undefined

  return (
    <div ref={containerRef} className="my-1">
      <div className="text-sm">
        <Markdown content={question} />
      </div>

      {isPending && (
        <div className="mt-2 border border-border rounded overflow-hidden">
          <div className="p-3 bg-primary space-y-2">
            {type === 'confirm' ? (
              <div className="flex flex-col gap-2 @md:flex-row">
                {[
                  {
                    key: 'yes',
                    answer: 'yes',
                    label: t({ en: 'Yes', fr: 'Oui' }),
                    variant:
                      'bg-accent-success/20 hover:bg-accent-success/30 text-accent-success border-accent-success/30',
                  },
                  {
                    key: 'no',
                    answer: 'no',
                    label: t({ en: 'No', fr: 'Non' }),
                    variant: 'bg-accent-error/20 hover:bg-accent-error/30 text-accent-error border-accent-error/30',
                  },
                ].map((opt, index) => {
                  const isRecommended = hasAutoAnswer && index === 0
                  return (
                    <div key={opt.key} className="relative flex-1">
                      <button
                        onClick={() => handleOptionSelect(opt.answer)}
                        className={`${btnBase} w-full border ${isRecommended ? RECOMMENDED_CLASS : ''} ${opt.variant}`}
                      >
                        {opt.label}
                      </button>
                      {isRecommended && pendingQuestion?.autoAnswerDeadline !== undefined && sessionId && (
                        <RecommendedCountdown
                          deadline={pendingQuestion.autoAnswerDeadline}
                          onCancel={cancelCountdown}
                        />
                      )}
                    </div>
                  )
                })}
                <button
                  onClick={handleSkip}
                  className={`${btnBase} flex-1 bg-bg-tertiary hover:bg-bg-tertiary/80 text-text-secondary border border-border`}
                >
                  {t({ en: 'Skip', fr: 'Passer' })}
                </button>
              </div>
            ) : type === 'choice' && choiceOptions !== undefined && choiceOptions.length > 0 ? (
              <>
                <div className="flex flex-col gap-1.5">
                  {choiceOptions.map((opt, index) => {
                    const isRecommended = hasAutoAnswer && index === 0
                    return (
                      <button
                        key={index}
                        onClick={() => handleOptionSelect(opt.value)}
                        className={`${btnBase} relative text-left w-full bg-bg-tertiary hover:bg-accent-primary/20 text-text-primary border ${
                          isRecommended
                            ? `${RECOMMENDED_CLASS} hover:border-accent-primary`
                            : 'border-border hover:border-accent-primary/50'
                        }`}
                      >
                        {opt.label !== undefined && <span className="block font-medium @md:pr-14">{opt.label}</span>}
                        {isRecommended && pendingQuestion?.autoAnswerDeadline !== undefined && sessionId && (
                          <RecommendedCountdown
                            deadline={pendingQuestion.autoAnswerDeadline}
                            onCancel={cancelCountdown}
                          />
                        )}
                        {opt.description !== undefined && (
                          <span className="block text-xs text-text-muted mt-0.5">{opt.description}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
                <div className="flex gap-2">
                  <textarea
                    ref={inputRef}
                    value={answer}
                    onChange={handleAnswerChange}
                    onKeyDown={handleKeyDown}
                    placeholder={t({
                      en: 'Or type your own answer... (Enter to submit)',
                      fr: 'Ou saisissez votre propre réponse... (Entrée pour envoyer)',
                    })}
                    className="flex-1 min-h-[36px] max-h-[80px] px-2 py-1.5 bg-bg-tertiary border border-border rounded text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50 resize-y"
                    rows={1}
                  />
                  <button
                    onClick={handleSubmit}
                    disabled={!answer.trim()}
                    className={`${btnBase} bg-accent-primary/25 hover:bg-accent-primary/40 text-text-primary disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {t({ en: 'Send', fr: 'Envoyer' })}
                  </button>
                  <button
                    onClick={handleSkip}
                    className={`${btnBase} bg-bg-tertiary hover:bg-bg-tertiary/80 text-text-secondary border border-border`}
                  >
                    {t({ en: 'Skip', fr: 'Passer' })}
                  </button>
                </div>
              </>
            ) : (
              <>
                <textarea
                  ref={inputRef}
                  value={answer}
                  onChange={handleAnswerChange}
                  onKeyDown={handleKeyDown}
                  placeholder={t({
                    en: 'Type your answer here... (Enter to submit, Shift+Enter for new line)',
                    fr: 'Saisissez votre réponse ici... (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne)',
                  })}
                  className="w-full min-h-[80px] px-3 py-2 bg-bg-tertiary border border-border rounded text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50 resize-y"
                  autoFocus={shouldAutofocus()}
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={handleSkip}
                    className={`${btnBase} bg-bg-tertiary hover:bg-bg-tertiary/80 text-text-secondary border border-border`}
                  >
                    {t({ en: 'Skip', fr: 'Passer' })}
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!answer.trim()}
                    className={`${btnBase} bg-accent-primary/25 hover:bg-accent-primary/40 text-text-primary disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {t({ en: 'Send Answer', fr: 'Envoyer la réponse' })}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {hasResult && (
        <div className="mt-1 flex items-center gap-2">
          <span className={`text-xs ${isSkipped ? 'text-amber-400' : 'text-accent-success'}`}>
            {isSkipped
              ? t({ en: 'Skipped', fr: 'Passée' })
              : wasAutoAnswered
                ? t(
                    { en: 'Answered automatically: {{answer}}', fr: 'Réponse automatique : {{answer}}' },
                    { answer: resultText },
                  )
                : t({ en: 'Answered: {{answer}}', fr: 'Réponse : {{answer}}' }, { answer: resultText })}
          </span>
        </div>
      )}
    </div>
  )
}
