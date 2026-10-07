import type { ToolResult } from '../../shared/types.js'
import type { Tool, ToolContext } from './types.js'
import type { PendingQuestionPayload, ChoiceOption } from '../../shared/protocol.js'
import { normalizeAskOptions } from '../../shared/ask-options.js'
import { createDeferred } from '../utils/async.js'

interface PendingQuestion {
  promise: Promise<string>
  resolve: (answer: string) => void
  reject: (error: Error) => void
  sessionId: string
  question: string
  type: 'text' | 'confirm' | 'choice'
  options: ChoiceOption[] | undefined
}

// Store pending questions by call ID
const pendingQuestions = new Map<string, PendingQuestion>()
const pendingCountBySession = new Map<string, number>()

function addPendingQuestion(callId: string, pending: PendingQuestion): void {
  removePendingQuestion(callId)
  pendingQuestions.set(callId, pending)
  pendingCountBySession.set(pending.sessionId, (pendingCountBySession.get(pending.sessionId) ?? 0) + 1)
}

function removePendingQuestion(callId: string): void {
  const pending = pendingQuestions.get(callId)
  if (!pending) return
  pendingQuestions.delete(callId)
  const remaining = (pendingCountBySession.get(pending.sessionId) ?? 1) - 1
  if (remaining > 0) {
    pendingCountBySession.set(pending.sessionId, remaining)
  } else {
    pendingCountBySession.delete(pending.sessionId)
  }
}

type AwaitingAnswerListener = (sessionId: string, awaiting: boolean) => void
const awaitingAnswerListeners = new Set<AwaitingAnswerListener>()

export function isSessionAwaitingAnswer(sessionId: string): boolean {
  return pendingCountBySession.has(sessionId)
}

export function onAwaitingAnswerChange(listener: AwaitingAnswerListener): () => void {
  awaitingAnswerListeners.add(listener)
  return () => {
    awaitingAnswerListeners.delete(listener)
  }
}

function trackAwaitingTransition<T>(sessionId: string, mutate: () => T): T {
  const before = isSessionAwaitingAnswer(sessionId)
  const result = mutate()
  const after = isSessionAwaitingAnswer(sessionId)
  if (before !== after) {
    for (const listener of awaitingAnswerListeners) {
      try {
        listener(sessionId, after)
      } catch {
        // a failing listener must not break question handling
      }
    }
  }
  return result
}

export const askUserTool: Tool = {
  name: 'ask_user',
  definition: {
    type: 'function',
    function: {
      name: 'ask_user',
      description:
        'Pause execution and ask the user a question. Use this when you need clarification or user input before proceeding.',
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

    // Night mode: no one is home to answer. Give the agent a synthetic
    // response so it keeps going with its own judgment instead of blocking.
    if (context.nightMode) {
      return {
        success: true,
        output:
          'Night mode is active: the user is unavailable and will not answer. Make your best judgment and proceed without asking.',
        durationMs: 0,
        truncated: false,
      }
    }

    const callId = context.toolCallId ?? crypto.randomUUID()

    const deferred = createDeferred<string>()
    void deferred.promise.catch(() => {})

    trackAwaitingTransition(context.sessionId, () =>
      addPendingQuestion(callId, {
        promise: deferred.promise,
        resolve: deferred.resolve,
        reject: deferred.reject,
        sessionId: context.sessionId,
        question,
        type,
        options,
      }),
    )

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

  pending.resolve(skip ? '[user skipped]' : answer)
  trackAwaitingTransition(pending.sessionId, () => removePendingQuestion(callId))
  return true
}

export function cancelQuestion(callId: string, reason: string): boolean {
  const pending = pendingQuestions.get(callId)
  if (!pending) {
    return false
  }

  pending.reject(new Error(reason))
  trackAwaitingTransition(pending.sessionId, () => removePendingQuestion(callId))
  return true
}

export function cancelQuestionsForSession(sessionId: string, reason: string): number {
  return trackAwaitingTransition(sessionId, () => {
    let cancelledCount = 0

    for (const [callId, pending] of pendingQuestions.entries()) {
      if (pending.sessionId !== sessionId) {
        continue
      }

      pending.reject(new Error(reason))
      removePendingQuestion(callId)
      cancelledCount += 1
    }

    return cancelledCount
  })
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
      result.push({ callId, question: pending.question, type: pending.type, options: pending.options })
    }
  }
  return result
}
