import { useState, useRef, useEffect, useCallback } from 'react'
import type { ToolCall } from '@shared/types.js'
import type { ChoiceOption } from '@shared/protocol.js'
import { useSessionStore, type PendingQuestion } from '../../stores/session'

interface AskUserCardProps {
  toolCall: ToolCall
}

// Coerce whatever the LLM / legacy storage handed us into the canonical
// `ChoiceOption[]` shape. The server-side ask_user boundary is the
// authoritative source for fresh events; this guard exists ONLY for events
// persisted by older builds (pre-fix) that still carry raw `string[]` or
// `{label, description}[]` payloads in the database.
//
// Accepted input shapes (none of them leak raw through):
//   - string[]                              → {value:s,label:s} per entry
//   - string                                "A, B" (comma-split) → each as ChoiceOption
//   - Array<{label, description?}>         → {value:label,label,description}
//   - Array<{value, label, description?}>  → preserve all three fields
//   - Mixed / malformed arrays              → filtered, never crashes
// Returns `null` when nothing usable remains, so callers fall through to
// free-text input.
function normalizeChoiceOptions(raw: unknown): ChoiceOption[] | null {
  if (raw == null) return null
  if (typeof raw === 'string') {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    return parts.length > 0 ? parts.map((label) => ({ value: label, label })) : null
  }
  if (!Array.isArray(raw)) return null

  const out: ChoiceOption[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      const trimmed = item.trim()
      if (trimmed.length > 0) {
        out.push({ value: trimmed, label: trimmed })
      }
      continue
    }
    if (item != null && typeof item === 'object') {
      const obj = item as Record<string, unknown>
      const labelRaw = obj['label']
      if (typeof labelRaw === 'string' && labelRaw.trim().length > 0) {
        const label = labelRaw.trim()
        const valueRaw = obj['value']
        const value = typeof valueRaw === 'string' && valueRaw.length > 0 ? valueRaw : label
        const descRaw = obj['description']
        const opt: ChoiceOption = { value, label }
        if (typeof descRaw === 'string' && descRaw.length > 0) {
          opt.description = descRaw
        }
        out.push(opt)
      }
      // Malformed objects (no string label) are silently dropped.
    }
    // Primitives other than string (numbers, booleans, null, undefined) are dropped.
  }
  return out.length > 0 ? out : null
}

export function AskUserCard({ toolCall }: AskUserCardProps) {
  const pendingQuestions = useSessionStore((state) => state.pendingQuestions)
  const answerQuestion = useSessionStore((state) => state.answerQuestion)
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
  const choiceOptions = normalizeChoiceOptions(rawOptions)

  const hasResult = toolCall.result !== undefined
  const isPending = pendingQuestion !== undefined && !hasResult

  const resultText = toolCall.result?.output ?? ''
  const isSkipped = resultText === '[user skipped]'

  useEffect(() => {
    if (isPending && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isPending])

  useEffect(() => {
    if (isPending && containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isPending])

  const handleSubmit = useCallback(() => {
    if (!pendingQuestion) return
    answerQuestion(pendingQuestion.callId, answer)
  }, [pendingQuestion, answer, answerQuestion])

  const handleSkip = useCallback(() => {
    if (!pendingQuestion) return
    answerQuestion(pendingQuestion.callId, '', true)
  }, [pendingQuestion, answerQuestion])

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
      if (!pendingQuestion) return
      answerQuestion(pendingQuestion.callId, option)
    },
    [pendingQuestion, answerQuestion],
  )

  const btnBase = 'px-3 py-1.5 text-xs font-medium rounded transition-colors'

  return (
    <div ref={containerRef} className="my-1">
      <div className="text-sm text-text-primary">{question}</div>

      {isPending && (
        <div className="mt-2 border border-border rounded overflow-hidden">
          <div className="p-3 bg-primary space-y-2">
            {type === 'confirm' ? (
              <div className="flex gap-2">
                <button
                  onClick={() => handleOptionSelect('yes')}
                  className={`${btnBase} flex-1 bg-accent-success/20 hover:bg-accent-success/30 text-accent-success border border-accent-success/30`}
                >
                  Yes
                </button>
                <button
                  onClick={() => handleOptionSelect('no')}
                  className={`${btnBase} flex-1 bg-accent-error/20 hover:bg-accent-error/30 text-accent-error border border-accent-error/30`}
                >
                  No
                </button>
                <button
                  onClick={handleSkip}
                  className={`${btnBase} bg-bg-tertiary hover:bg-bg-tertiary/80 text-text-secondary border border-border`}
                >
                  Skip
                </button>
              </div>
            ) : type === 'choice' && choiceOptions !== null && choiceOptions.length > 0 ? (
              <>
                <div className="flex flex-col gap-1.5">
                  {choiceOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => handleOptionSelect(opt.value)}
                      className={`${btnBase} text-left w-full bg-bg-tertiary hover:bg-accent-primary/20 text-text-primary border border-border hover:border-accent-primary/50`}
                    >
                      <span className="block font-medium">{opt.label}</span>
                      {opt.description !== undefined && (
                        <span className="block text-xs text-text-muted mt-0.5">{opt.description}</span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <textarea
                    ref={inputRef}
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Or type your own answer... (Enter to submit)"
                    className="flex-1 min-h-[36px] max-h-[80px] px-2 py-1.5 bg-bg-tertiary border border-border rounded text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50 resize-y"
                    rows={1}
                  />
                  <button
                    onClick={handleSubmit}
                    disabled={!answer.trim()}
                    className={`${btnBase} bg-accent-primary/25 hover:bg-accent-primary/40 text-text-primary disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    Send
                  </button>
                  <button
                    onClick={handleSkip}
                    className={`${btnBase} bg-bg-tertiary hover:bg-bg-tertiary/80 text-text-secondary border border-border`}
                  >
                    Skip
                  </button>
                </div>
              </>
            ) : (
              <>
                <textarea
                  ref={inputRef}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your answer here... (Enter to submit, Shift+Enter for new line)"
                  className="w-full min-h-[80px] px-3 py-2 bg-bg-tertiary border border-border rounded text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50 resize-y"
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={handleSkip}
                    className={`${btnBase} bg-bg-tertiary hover:bg-bg-tertiary/80 text-text-secondary border border-border`}
                  >
                    Skip
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!answer.trim()}
                    className={`${btnBase} bg-accent-primary/25 hover:bg-accent-primary/40 text-text-primary disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    Send Answer
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
            {isSkipped ? 'Skipped' : `Answered: ${resultText}`}
          </span>
        </div>
      )}
    </div>
  )
}
