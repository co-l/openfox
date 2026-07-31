import { describe, expect, it } from 'vitest'
import {
  AskUserInterrupt,
  askUserTool,
  cancelQuestion,
  cancelQuestionsForSession,
  hasPendingQuestion,
  provideAnswer,
  getPendingQuestionsForSession,
  normalizeAskOptions,
} from './ask.js'

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

describe('normalizeAskOptions', () => {
  it('returns undefined for null/undefined input', () => {
    expect(normalizeAskOptions(undefined)).toBeUndefined()
    expect(normalizeAskOptions(null)).toBeUndefined()
  })

  it('returns undefined for non-array input (string, number, plain object)', () => {
    // None of these are valid for the protocol contract — we always
    // produce `undefined`, never an object, to avoid crashing the renderer.
    expect(normalizeAskOptions('A, B')).toBeUndefined()
    expect(normalizeAskOptions(42)).toBeUndefined()
    expect(normalizeAskOptions({ label: 'A' })).toBeUndefined()
  })

  it('trims string entries and drops empty ones', () => {
    expect(normalizeAskOptions([' A ', '', 'B', '   '])).toEqual([
      { value: 'A', label: 'A' },
      { value: 'B', label: 'B' },
    ])
  })

  it('preserves {label, description} as canonical {value, label, description}', () => {
    expect(
      normalizeAskOptions([
        { label: 'Continuer', description: 'Reprendre le flux principal' },
        { label: 'Annuler', description: 'Stopper ici' },
      ]),
    ).toEqual([
      { value: 'Continuer', label: 'Continuer', description: 'Reprendre le flux principal' },
      { value: 'Annuler', label: 'Annuler', description: 'Stopper ici' },
    ])
  })

  it('preserves {value, label, description} verbatim', () => {
    expect(
      normalizeAskOptions([
        { value: 'yes-v', label: 'Oui', description: 'Yes' },
        { value: 'no-v', label: 'Non', description: 'No' },
      ]),
    ).toEqual([
      { value: 'yes-v', label: 'Oui', description: 'Yes' },
      { value: 'no-v', label: 'Non', description: 'No' },
    ])
  })

  it('drops malformed entries silently and never leaks raw objects', () => {
    const result = normalizeAskOptions([
      null,
      undefined,
      42,
      true,
      { label: 'OK' },
      { label: '' },
      { description: 'no label here' },
      { label: 123 }, // non-string label → dropped
      'legacy-string-entry',
    ] as unknown as unknown[])
    expect(result).toEqual([
      { value: 'OK', label: 'OK' },
      { value: 'legacy-string-entry', label: 'legacy-string-entry' },
    ])
    // Every emitted entry must be a structured object — never a raw string
    // or array (would crash React when rendered as a child).
    for (const item of result ?? []) {
      expect(typeof item).toBe('object')
      expect(item).not.toBeNull()
      expect(typeof (item as { value: unknown }).value).toBe('string')
    }
  })

  it('returns undefined when every entry is malformed', () => {
    expect(
      normalizeAskOptions([null, undefined, 42, { label: '' }, { foo: 'bar' }] as unknown as unknown[]),
    ).toBeUndefined()
  })
})
