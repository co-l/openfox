import type { ToolResult } from '../../shared/types.js'
import type { Tool, ToolContext } from './types.js'
import type {
  ServerMessage,
  PendingQuestionPayload,
  ChatAutoAnswerPayload,
  ChoiceOption,
} from '../../shared/protocol.js'
import { createServerMessage } from '../../shared/protocol.js'
import { normalizeAskOptions } from '../../shared/ask-options.js'
import { createDeferred } from '../utils/async.js'
import { getProjectAutoAnswerQuestions } from '../db/projects.js'
import { getSetting, SETTINGS_KEYS } from '../db/settings.js'
import { DEFAULT_AUTO_ACTION_TIMEOUT_SECONDS } from '../utils/auto-action-timeout.js'
import { logger } from '../utils/logger.js'

/** Calls the countdown answered automatically; consumed once when the tool
 *  result is recorded so the feed can say "Answered automatically". */
const autoAnsweredCalls = new Set<string>()

export function consumeAutoAnswered(callId: string): boolean {
  if (!autoAnsweredCalls.has(callId)) return false
  autoAnsweredCalls.delete(callId)
  return true
}

// Store pending questions by call ID
const pendingQuestions = new Map<
  string,
  {
    promise: Promise<string>
    resolve: (answer: string) => void
    reject: (error: Error) => void
    sessionId: string
    question: string
    type: 'text' | 'confirm' | 'choice'
    options: ChoiceOption[] | undefined
  }
>()

interface PendingAutoAnswer {
  sessionId: string
  deadline: number
  timer: ReturnType<typeof setTimeout>
}

const autoAnswers = new Map<string, PendingAutoAnswer>()

let autoAnswerDeps: {
  broadcast: (sessionId: string, msg: ServerMessage) => void
  resolveDelayMs: (projectId?: string) => number
} | null = null

export function initAutoAnswer(deps: {
  broadcast: (sessionId: string, msg: ServerMessage) => void
  resolveDelayMs: (projectId?: string) => number
}): void {
  autoAnswerDeps = deps
}

/** Project override first, then the global setting; off by default. */
export function isAutoAnswerEnabled(projectId?: string): boolean {
  if (projectId) {
    try {
      const projectValue = getProjectAutoAnswerQuestions(projectId)
      if (projectValue !== null) return projectValue
    } catch {
      // fall through to the global setting
    }
  }
  try {
    return getSetting(SETTINGS_KEYS.AUTO_ANSWER_QUESTIONS) === 'true'
  } catch {
    return false
  }
}

/** The answer the countdown applies on expiry; null = not auto-answerable (free text). */
export function autoAnswerFor(type: 'text' | 'confirm' | 'choice', options?: ChoiceOption[]): string | null {
  if (type === 'confirm') return 'yes'
  if (type === 'choice') return options?.[0]?.value ?? null
  return null
}

/**
 * Arm the auto-answer countdown for a freshly-asked question. No-op when the
 * feature is off, the question has no recommended answer (free text), or the
 * answer was already provided. The server owns the timer: clients only render
 * the deadline, so reloads/reconnects keep an accurate countdown.
 */
export function armAutoAnswer(params: {
  callId: string
  sessionId: string
  projectId?: string | undefined
  type: 'text' | 'confirm' | 'choice'
  options?: ChoiceOption[] | undefined
}): void {
  if (autoAnswers.has(params.callId) || !pendingQuestions.has(params.callId)) return
  if (!isAutoAnswerEnabled(params.projectId)) return

  const answer = autoAnswerFor(params.type, params.options)
  if (answer === null) return

  const delayMs = autoAnswerDeps?.resolveDelayMs(params.projectId) ?? DEFAULT_AUTO_ACTION_TIMEOUT_SECONDS * 1000
  const deadline = Date.now() + delayMs
  const timer = setTimeout(() => {
    if (!autoAnswers.delete(params.callId)) return
    autoAnsweredCalls.add(params.callId)
    provideAnswer(params.callId, answer)
    autoAnswerDeps?.broadcast(
      params.sessionId,
      createServerMessage<ChatAutoAnswerPayload>('chat.autoanswer', {
        active: false,
        callId: params.callId,
        answered: true,
      }),
    )
    logger.info('Question auto-answered after countdown', { sessionId: params.sessionId, callId: params.callId })
  }, delayMs)
  timer.unref?.()

  autoAnswers.set(params.callId, { sessionId: params.sessionId, deadline, timer })
  autoAnswerDeps?.broadcast(
    params.sessionId,
    createServerMessage<ChatAutoAnswerPayload>('chat.autoanswer', { active: true, callId: params.callId, deadline }),
  )
}

function clearedAutoAnswerMessage(callId: string): ServerMessage<ChatAutoAnswerPayload> {
  return createServerMessage<ChatAutoAnswerPayload>('chat.autoanswer', { active: false, callId })
}

/** Cancel one countdown and notify clients (user picked an option / answered). */
export function cancelAutoAnswer(callId: string): void {
  const entry = autoAnswers.get(callId)
  if (!entry) return
  clearTimeout(entry.timer)
  autoAnswers.delete(callId)
  autoAnswerDeps?.broadcast(entry.sessionId, clearedAutoAnswerMessage(callId))
}

/** Cancel every countdown of a session (first keystroke). */
export function cancelAutoAnswersForSession(sessionId: string): void {
  for (const callId of [...autoAnswers.keys()]) {
    if (autoAnswers.get(callId)?.sessionId === sessionId) cancelAutoAnswer(callId)
  }
}

/** Test seam: drop all timers without firing or broadcasting. */
export function clearAllAutoAnswers(): void {
  for (const entry of autoAnswers.values()) clearTimeout(entry.timer)
  autoAnswers.clear()
  autoAnsweredCalls.clear()
}

export const askUserTool: Tool = {
  name: 'ask_user',
  definition: {
    type: 'function',
    function: {
      name: 'ask_user',
      description:
        'Pause execution and ask the user a question. Use this when you need clarification or user input before proceeding. Prefer type "choice" (with the recommended option first) or "confirm": when auto-answer mode is enabled, unanswered questions are answered with the first option (or "Yes") after a countdown, and free-text questions are rejected.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The question to ask the user',
          },
          type: {
            type: 'string',
            enum: ['text', 'confirm', 'choice'],
            description: 'Type of question (text, confirm, or choice)',
          },
          options: {
            type: 'array',
            description:
              'Options for choice-type questions. Each entry may be a plain string or an object {value, label, description?} (or legacy {label, description?}). The server normalizes everything to {value, label, description?}.',
            items: {
              type: 'object',
              properties: {
                value: { type: 'string' },
                label: { type: 'string' },
                description: { type: 'string' },
              },
              required: ['label'],
            },
          },
        },
        required: ['question'],
      },
    },
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const question = args['question'] as string
    const type = (args['type'] as 'text' | 'confirm' | 'choice') ?? 'text'
    const options = normalizeAskOptions(args['options'])

    const projectId = context.sessionManager.getSession?.(context.sessionId)?.projectId
    if (type === 'text' && isAutoAnswerEnabled(projectId)) {
      return {
        success: false,
        error:
          'Free-text questions are disabled while auto-answer is on: ask with type "choice" and put your recommended option first, or use type "confirm".',
        durationMs: 0,
        truncated: false,
      }
    }

    const callId = context.toolCallId ?? crypto.randomUUID()

    const deferred = createDeferred<string>()
    void deferred.promise.catch(() => {})

    pendingQuestions.set(callId, {
      promise: deferred.promise,
      resolve: deferred.resolve,
      reject: deferred.reject,
      sessionId: context.sessionId,
      question,
      type,
      options,
    })

    throw new AskUserInterrupt(callId, question, type, options)
  },
}

export class AskUserInterrupt extends Error {
  constructor(
    public readonly callId: string,
    public readonly question: string,
    public readonly type: 'text' | 'confirm' | 'choice' = 'text',
    public readonly options?: ChoiceOption[],
  ) {
    super('Ask user interrupt')
    this.name = 'AskUserInterrupt'
  }
}

export function provideAnswer(callId: string, answer: string, skip?: boolean): boolean {
  const pending = pendingQuestions.get(callId)
  if (!pending) {
    return false
  }

  cancelAutoAnswer(callId)
  pending.resolve(skip ? '[user skipped]' : answer)
  pendingQuestions.delete(callId)
  return true
}

export function cancelQuestion(callId: string, reason: string): boolean {
  const pending = pendingQuestions.get(callId)
  if (!pending) {
    return false
  }

  cancelAutoAnswer(callId)
  pending.reject(new Error(reason))
  pendingQuestions.delete(callId)
  return true
}

export function cancelQuestionsForSession(sessionId: string, reason: string): number {
  let cancelledCount = 0

  for (const [callId, pending] of pendingQuestions.entries()) {
    if (pending.sessionId !== sessionId) {
      continue
    }

    cancelAutoAnswer(callId)
    pending.reject(new Error(reason))
    pendingQuestions.delete(callId)
    cancelledCount += 1
  }

  return cancelledCount
}

export function hasPendingQuestion(callId: string): boolean {
  return pendingQuestions.has(callId)
}

export function awaitAnswer(callId: string): Promise<string> | null {
  const pending = pendingQuestions.get(callId)
  return pending?.promise ?? null
}

export function getPendingQuestionsForSession(sessionId: string): PendingQuestionPayload[] {
  const result: PendingQuestionPayload[] = []
  for (const [callId, pending] of pendingQuestions.entries()) {
    if (pending.sessionId === sessionId) {
      const deadline = autoAnswers.get(callId)?.deadline
      result.push({
        callId,
        question: pending.question,
        type: pending.type,
        options: pending.options,
        ...(deadline !== undefined ? { autoAnswerDeadline: deadline } : {}),
      })
    }
  }
  return result
}
