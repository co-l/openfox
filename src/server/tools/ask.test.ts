import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerMessage } from '../../shared/protocol.js'
import { loadConfig } from '../config.js'
import { closeDatabase, initDatabase } from '../db/index.js'
import { createProject, updateProject } from '../db/projects.js'
import { SETTINGS_KEYS, deleteSetting, setSetting } from '../db/settings.js'
import {
  AskUserInterrupt,
  awaitAnswer,
  armAutoAnswer,
  askUserTool,
  cancelAutoAnswer,
  cancelAutoAnswersForSession,
  cancelQuestion,
  cancelQuestionsForSession,
  clearAllAutoAnswers,
  consumeAutoAnswered,
  hasPendingQuestion,
  initAutoAnswer,
  provideAnswer,
  getPendingQuestionsForSession,
} from './ask.js'
import { resolveAutoActionTimeoutSeconds } from '../utils/auto-action-timeout.js'

const TEST_TIMEOUT_MS = 90_000

function ctx(sessionId: string, toolCallId?: string) {
  return {
    workdir: '/tmp/project',
    sessionId,
    sessionManager: {} as never,
    ...(toolCallId !== undefined ? { toolCallId } : {}),
  }
}

describe('ask_user auto-answer countdown', () => {
  let broadcasts: ServerMessage[]

  beforeEach(() => {
    vi.useFakeTimers()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
    broadcasts = []
    initAutoAnswer({
      broadcast: (_sessionId, msg) => broadcasts.push(msg),
      resolveDelayMs: (projectId) => resolveAutoActionTimeoutSeconds(projectId) * 1000,
    })
  })

  afterEach(() => {
    clearAllAutoAnswers()
    deleteSetting(SETTINGS_KEYS.AUTO_ANSWER_QUESTIONS)
    deleteSetting(SETTINGS_KEYS.AUTO_ACTION_TIMEOUT)
    closeDatabase()
    vi.useRealTimers()
  })

  async function ask(args: Record<string, unknown>, callId: string): Promise<AskUserInterrupt> {
    try {
      await askUserTool.execute(args, ctx('session-auto', callId))
    } catch (error) {
      return error as AskUserInterrupt
    }
    throw new Error('expected AskUserInterrupt')
  }

  it('auto-answers a choice question with the first option after the timeout', async () => {
    setSetting(SETTINGS_KEYS.AUTO_ANSWER_QUESTIONS, 'true')
    const interrupt = await ask(
      { question: 'Pick one:', type: 'choice', options: ['React', 'Vue'] },
      'call-auto-choice',
    )

    armAutoAnswer({ callId: interrupt.callId, sessionId: 'session-auto', type: 'choice', options: interrupt.options })
    const isActive = (b: ServerMessage): boolean => Boolean((b.payload as { active?: boolean }).active)
    expect(broadcasts.filter((b) => b.type === 'chat.autoanswer' && isActive(b))).toHaveLength(1)

    const answerPromise = awaitAnswer(interrupt.callId)!
    vi.advanceTimersByTime(TEST_TIMEOUT_MS)
    expect(await answerPromise).toBe('React')
    expect(hasPendingQuestion(interrupt.callId)).toBe(false)
    // Cleared broadcast on expiry.
    expect(broadcasts.at(-1)!.type).toBe('chat.autoanswer')
    expect(isActive(broadcasts.at(-1)!)).toBe(false)
  })

  it('auto-answers a confirm question with yes after the timeout', async () => {
    setSetting(SETTINGS_KEYS.AUTO_ANSWER_QUESTIONS, 'true')
    const interrupt = await ask({ question: 'Proceed?', type: 'confirm' }, 'call-auto-confirm')

    armAutoAnswer({ callId: interrupt.callId, sessionId: 'session-auto', type: 'confirm' })
    const answerPromise = awaitAnswer(interrupt.callId)!
    vi.advanceTimersByTime(TEST_TIMEOUT_MS)
    expect(await answerPromise).toBe('yes')
  })

  it('never auto-answers free-text questions and does not arm while disabled', async () => {
    // Free-text pending question (asked while the mode is off): arming it even
    // after enabling must stay a no-op — only choice/confirm auto-answer.
    const text = await ask({ question: 'What name?' }, 'call-auto-text')
    setSetting(SETTINGS_KEYS.AUTO_ANSWER_QUESTIONS, 'true')
    armAutoAnswer({ callId: text.callId, sessionId: 'session-auto', type: 'text' })
    expect(broadcasts).toHaveLength(0)

    deleteSetting(SETTINGS_KEYS.AUTO_ANSWER_QUESTIONS)
    const choice = await ask({ question: 'Pick:', type: 'choice', options: ['A'] }, 'call-auto-off')
    armAutoAnswer({ callId: choice.callId, sessionId: 'session-auto', type: 'choice', options: choice.options })
    expect(broadcasts).toHaveLength(0)
    vi.advanceTimersByTime(TEST_TIMEOUT_MS + 1000)
    expect(hasPendingQuestion(choice.callId)).toBe(true)

    provideAnswer('call-auto-off', 'A')
    provideAnswer('call-auto-text', 'Bob')
  })

  it('answering or skipping before expiry cancels the countdown; nothing fires', async () => {
    setSetting(SETTINGS_KEYS.AUTO_ANSWER_QUESTIONS, 'true')
    const interrupt = await ask({ question: 'Pick:', type: 'choice', options: ['A', 'B'] }, 'call-auto-cancel')
    armAutoAnswer({ callId: interrupt.callId, sessionId: 'session-auto', type: 'choice', options: interrupt.options })

    expect(provideAnswer(interrupt.callId, 'B')).toBe(true)
    vi.advanceTimersByTime(TEST_TIMEOUT_MS + 1000)
    // The user's answer stands; the countdown never overwrote it nor fired a second time.
    expect(broadcasts.filter((b) => b.type === 'chat.autoanswer')).toHaveLength(2) // active + cleared by provideAnswer
    expect(Boolean((broadcasts.at(-1)!.payload as { active?: boolean }).active)).toBe(false)
  })

  it('cancelAutoAnswer and cancelAutoAnswersForSession drop pending countdowns', async () => {
    setSetting(SETTINGS_KEYS.AUTO_ANSWER_QUESTIONS, 'true')
    const a = await ask({ question: 'Pick A?', type: 'choice', options: ['A'] }, 'call-aa-a')
    armAutoAnswer({ callId: a.callId, sessionId: 'session-auto', type: 'choice', options: a.options })
    vi.advanceTimersByTime(1000)

    cancelAutoAnswer(a.callId)
    vi.advanceTimersByTime(TEST_TIMEOUT_MS)
    expect(hasPendingQuestion(a.callId)).toBe(true)
    provideAnswer('call-aa-a', 'A')

    const b = await ask({ question: 'Pick B?', type: 'choice', options: ['B'] }, 'call-aa-b')
    armAutoAnswer({ callId: b.callId, sessionId: 'session-auto', type: 'choice', options: b.options })
    cancelAutoAnswersForSession('session-auto')
    vi.advanceTimersByTime(TEST_TIMEOUT_MS)
    expect(hasPendingQuestion(b.callId)).toBe(true)

    // Cancelling an un-armed call is a no-op.
    cancelAutoAnswer('nope')
    provideAnswer('call-aa-b', 'B')
  })

  it('marks expired countdown answers as auto-answered, consumed once', async () => {
    setSetting(SETTINGS_KEYS.AUTO_ANSWER_QUESTIONS, 'true')
    const interrupt = await ask({ question: 'Pick:', type: 'choice', options: ['A'] }, 'call-aa-flag')
    armAutoAnswer({ callId: interrupt.callId, sessionId: 'session-auto', type: 'choice', options: interrupt.options })

    expect(consumeAutoAnswered(interrupt.callId)).toBe(false)
    const answerPromise = awaitAnswer(interrupt.callId)!
    vi.advanceTimersByTime(TEST_TIMEOUT_MS)
    await answerPromise

    expect(consumeAutoAnswered(interrupt.callId)).toBe(true)
    expect(consumeAutoAnswered(interrupt.callId)).toBe(false)
  })

  it('uses the project override for the countdown duration', async () => {
    const project = createProject('ask-timeout', '/tmp/ask-timeout-project')
    updateProject(project.id, { autoActionTimeoutSeconds: 15 })
    setSetting(SETTINGS_KEYS.AUTO_ANSWER_QUESTIONS, 'true')
    const interrupt = await ask({ question: 'Pick:', type: 'choice', options: ['A'] }, 'call-aa-proj-timeout')
    armAutoAnswer({
      callId: interrupt.callId,
      sessionId: 'session-auto',
      projectId: project.id,
      type: 'choice',
      options: interrupt.options,
    })

    const answerPromise = awaitAnswer(interrupt.callId)!
    vi.advanceTimersByTime(15_000)
    expect(await answerPromise).toBe('A')
  })

  it('rejects free-text ask_user while auto-answer mode is on', async () => {
    setSetting(SETTINGS_KEYS.AUTO_ANSWER_QUESTIONS, 'true')
    const result = await askUserTool.execute({ question: 'What name?' }, ctx('session-auto', 'call-text-reject'))

    expect(result.success).toBe(false)
    expect(result.error).toContain('choice')
    expect(hasPendingQuestion('call-text-reject')).toBe(false)
  })

  it('exposes the countdown deadline on pending questions for reload sync', async () => {
    setSetting(SETTINGS_KEYS.AUTO_ANSWER_QUESTIONS, 'true')
    const interrupt = await ask({ question: 'Pick:', type: 'choice', options: ['A'] }, 'call-aa-pending')
    armAutoAnswer({ callId: interrupt.callId, sessionId: 'session-auto', type: 'choice', options: interrupt.options })

    const pending = getPendingQuestionsForSession('session-auto')
    expect(pending[0]!.autoAnswerDeadline).toBeGreaterThan(Date.now())

    cancelAutoAnswer(interrupt.callId)
    expect(getPendingQuestionsForSession('session-auto')[0]!.autoAnswerDeadline).toBeUndefined()
    provideAnswer('call-aa-pending', 'A')
  })
})

describe('ask_user tool', () => {
  it('throws an AskUserInterrupt and tracks the pending question', async () => {
    let interrupt: AskUserInterrupt | null = null

    try {
      await askUserTool.execute(
        { question: 'Which backend should I use?' },
        {
          workdir: '/tmp/project',
          sessionId: 'session-1',
          sessionManager: {} as never,
          toolCallId: 'call-1',
        },
      )
    } catch (error) {
      interrupt = error as AskUserInterrupt
    }

    expect(interrupt).toBeInstanceOf(AskUserInterrupt)
    expect(interrupt?.question).toBe('Which backend should I use?')
    expect(interrupt?.callId).toBe('call-1')
    expect(interrupt && hasPendingQuestion(interrupt.callId)).toBe(true)
    expect(provideAnswer(interrupt!.callId, 'Use vLLM')).toBe(true)
    expect(hasPendingQuestion(interrupt!.callId)).toBe(false)
  })

  it('uses toolCallId from context', async () => {
    let interrupt: AskUserInterrupt | null = null

    try {
      await askUserTool.execute(
        { question: 'Test?' },
        {
          workdir: '/tmp/project',
          sessionId: 'session-1',
          sessionManager: {} as never,
          toolCallId: 'custom-call-id',
        },
      )
    } catch (error) {
      interrupt = error as AskUserInterrupt
    }

    expect(interrupt?.callId).toBe('custom-call-id')
    provideAnswer('custom-call-id', 'yes')
  })

  it('provideAnswer with skip=true returns [user skipped]', async () => {
    let interrupt: AskUserInterrupt | null = null

    try {
      await askUserTool.execute(
        { question: 'Proceed?' },
        {
          workdir: '/tmp/project',
          sessionId: 'session-skip',
          sessionManager: {} as never,
          toolCallId: 'call-skip',
        },
      )
    } catch (error) {
      interrupt = error as AskUserInterrupt
    }

    expect(provideAnswer(interrupt!.callId, '', true)).toBe(true)
    expect(hasPendingQuestion(interrupt!.callId)).toBe(false)
  })

  it('handles type and options in execute', async () => {
    let interrupt: AskUserInterrupt | null = null

    try {
      await askUserTool.execute(
        { question: 'Pick one:', type: 'choice', options: ['A', 'B', 'C'] },
        {
          workdir: '/tmp/project',
          sessionId: 'session-2',
          sessionManager: {} as never,
          toolCallId: 'call-2',
        },
      )
    } catch (error) {
      interrupt = error as AskUserInterrupt
    }

    expect(interrupt?.type).toBe('choice')
    expect(interrupt?.options).toEqual([
      { value: 'A', label: 'A' },
      { value: 'B', label: 'B' },
      { value: 'C', label: 'C' },
    ])
    expect(interrupt?.callId).toBe('call-2')
    provideAnswer('call-2', 'A')
  })

  it('cancels pending questions and returns false for unknown ids', async () => {
    let interrupt: AskUserInterrupt | null = null

    try {
      await askUserTool.execute(
        { question: 'Need approval?' },
        {
          workdir: '/tmp/project',
          sessionId: 'session-1',
          sessionManager: {} as never,
          toolCallId: 'call-cancel',
        },
      )
    } catch (error) {
      interrupt = error as AskUserInterrupt
    }

    expect(cancelQuestion(interrupt!.callId, 'user declined')).toBe(true)
    expect(hasPendingQuestion(interrupt!.callId)).toBe(false)
    expect(provideAnswer('missing', 'nope')).toBe(false)
    expect(cancelQuestion('missing', 'nope')).toBe(false)
  })

  it('cancels all pending questions for a session', async () => {
    const interrupts: AskUserInterrupt[] = []

    for (const [i, sessionId] of ['session-1', 'session-1', 'session-2'].entries()) {
      try {
        await askUserTool.execute(
          { question: `Question for ${sessionId}` },
          {
            workdir: '/tmp/project',
            sessionId,
            sessionManager: {} as never,
            toolCallId: `call-cancel-${i}`,
          },
        )
      } catch (error) {
        interrupts.push(error as AskUserInterrupt)
      }
    }

    expect(cancelQuestionsForSession('session-1', 'session aborted')).toBe(2)
    expect(hasPendingQuestion(interrupts[0]!.callId)).toBe(false)
    expect(hasPendingQuestion(interrupts[1]!.callId)).toBe(false)
    expect(hasPendingQuestion(interrupts[2]!.callId)).toBe(true)
    expect(cancelQuestionsForSession('missing', 'noop')).toBe(0)

    expect(cancelQuestion(interrupts[2]!.callId, 'cleanup')).toBe(true)
  })

  it('preserves {label, description} as canonical {value, label, description} at the boundary', async () => {
    // Non-lossy contract: when an LLM emits options as objects
    //   [{label, description}, ...]
    // the server-side ask_user boundary normalizes them into the canonical
    // ChoiceOption[] shape so downstream consumers (chat.ask_user event,
    // fold-state replay, session.state.pendingQuestions, REST
    // /api/sessions/:id) all receive structured entries with the description
    // field preserved.
    let interrupt: AskUserInterrupt | null = null

    const rawOptions = [
      { label: 'Continuer', description: 'Reprendre le flux principal' },
      { label: 'Annuler', description: 'Stopper ici' },
    ]

    try {
      await askUserTool.execute(
        { question: 'Pick:', type: 'choice', options: rawOptions },
        {
          workdir: '/tmp/project',
          sessionId: 'session-structured',
          sessionManager: {} as never,
          toolCallId: 'call-structured',
        },
      )
    } catch (error) {
      interrupt = error as AskUserInterrupt
    }

    // AskUserInterrupt.options must be the canonical ChoiceOption[] shape.
    expect(interrupt?.options).toEqual([
      { value: 'Continuer', label: 'Continuer', description: 'Reprendre le flux principal' },
      { value: 'Annuler', label: 'Annuler', description: 'Stopper ici' },
    ])
    expect(Array.isArray(interrupt?.options)).toBe(true)
    for (const item of interrupt?.options ?? []) {
      expect(typeof item).toBe('object')
      expect(item).not.toBeNull()
      expect(typeof (item as { value: unknown }).value).toBe('string')
      expect(typeof (item as { label: unknown }).label).toBe('string')
    }

    // getPendingQuestionsForSession must expose the same canonical shape
    // (this is what feeds session.state.pendingQuestions on reload).
    const pending = getPendingQuestionsForSession('session-structured')
    expect(pending.length).toBe(1)
    expect(pending[0]?.options).toEqual([
      { value: 'Continuer', label: 'Continuer', description: 'Reprendre le flux principal' },
      { value: 'Annuler', label: 'Annuler', description: 'Stopper ici' },
    ])

    provideAnswer('call-structured', 'Continuer')
  })

  it('drops malformed entries (no string label) instead of leaking raw objects', async () => {
    let interrupt: AskUserInterrupt | null = null

    try {
      await askUserTool.execute(
        {
          question: 'Pick:',
          type: 'choice',
          options: [
            null,
            undefined,
            42,
            true,
            { label: 'OK' },
            { label: '' }, // empty label → dropped
            { description: 'no label here' }, // no label → dropped
            { label: 123 }, // non-string label → dropped
            { label: 'Second' },
            'legacy-string-entry',
          ] as unknown as string[],
        },
        {
          workdir: '/tmp/project',
          sessionId: 'session-malformed',
          sessionManager: {} as never,
          toolCallId: 'call-malformed',
        },
      )
    } catch (error) {
      interrupt = error as AskUserInterrupt
    }

    // Only entries with a non-empty string label are kept; each is normalized
    // to a ChoiceOption. description is preserved only when present.
    expect(interrupt?.options).toEqual([
      { value: 'OK', label: 'OK' },
      { value: 'Second', label: 'Second' },
      { value: 'legacy-string-entry', label: 'legacy-string-entry' },
    ])
    expect(Array.isArray(interrupt?.options)).toBe(true)
    for (const item of interrupt?.options ?? []) {
      expect(typeof item).toBe('object')
      expect(item).not.toBeNull()
      expect(typeof (item as { value: unknown }).value).toBe('string')
    }

    provideAnswer('call-malformed', 'OK')
  })

  it('passes through a clean string[] as ChoiceOption[] (value === label, no description)', async () => {
    let interrupt: AskUserInterrupt | null = null

    try {
      await askUserTool.execute(
        { question: 'Pick:', type: 'choice', options: ['A', 'B'] },
        {
          workdir: '/tmp/project',
          sessionId: 'session-passthrough',
          sessionManager: {} as never,
          toolCallId: 'call-passthrough',
        },
      )
    } catch (error) {
      interrupt = error as AskUserInterrupt
    }

    // String[] is normalized to ChoiceOption[] with value === label and no
    // description. The result must NOT alias the input array.
    expect(interrupt?.options).toEqual([
      { value: 'A', label: 'A' },
      { value: 'B', label: 'B' },
    ])
    expect(interrupt?.options).not.toBe(['A', 'B'])

    provideAnswer('call-passthrough', 'A')
  })

  it('reload/replay: emits chat.ask_user payload with canonical ChoiceOption[] when LLM passed {label, description}', async () => {
    // The chat.ask_user event is appended to the EventStore by execute-tools.ts
    // based on the AskUserInterrupt fields. We don't replay the EventStore
    // here (that is fold-state territory), but we DO assert the upstream
    // invariant that the in-memory payload is already canonical — which is
    // what gets persisted for reload.
    let interrupt: AskUserInterrupt | null = null

    try {
      await askUserTool.execute(
        {
          question: 'Pick:',
          type: 'choice',
          options: [
            { label: 'Oui', description: 'Yes' },
            { label: 'Non', description: 'No' },
          ],
        },
        {
          workdir: '/tmp/project',
          sessionId: 'session-replay',
          sessionManager: {} as never,
          toolCallId: 'call-replay',
        },
      )
    } catch (error) {
      interrupt = error as AskUserInterrupt
    }

    // This is the exact payload shape that flows through execute-tools.ts →
    // EventStore → session.state.pendingQuestions on reload.
    expect(interrupt?.type).toBe('choice')
    expect(interrupt?.options).toEqual([
      { value: 'Oui', label: 'Oui', description: 'Yes' },
      { value: 'Non', label: 'Non', description: 'No' },
    ])

    provideAnswer('call-replay', 'Oui')
  })

  it('getPendingQuestionsForSession returns pending questions', async () => {
    try {
      await askUserTool.execute(
        { question: 'What framework?', type: 'choice', options: ['React', 'Vue'] },
        {
          workdir: '/tmp/project',
          sessionId: 'session-list',
          sessionManager: {} as never,
          toolCallId: 'call-list-1',
        },
      )
    } catch {
      // expected
    }

    const pending = getPendingQuestionsForSession('session-list')
    expect(pending.length).toBe(1)
    expect(pending[0]!.callId).toBe('call-list-1')
    expect(pending[0]!.question).toBe('What framework?')
    expect(pending[0]!.type).toBe('choice')
    expect(pending[0]!.options).toEqual([
      { value: 'React', label: 'React' },
      { value: 'Vue', label: 'Vue' },
    ])

    provideAnswer('call-list-1', 'React')
    expect(getPendingQuestionsForSession('session-list').length).toBe(0)
  })
})
