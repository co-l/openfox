// Red tests for the non-lossy ask_user option normalization.
//
// These tests assert the CANONICAL contract that replaces the rejected
// string[] normalization of commit 5674623:
//
//   PendingQuestionPayload.options === ChoiceOption[] | undefined
//   ChoiceOption === { value: string; label: string; description?: string }
//
// Acceptance criteria from the user brief:
//   - string[] legacy                       -> {value:s,label:s} (description omitted)
//   - [{label,description}]                 -> {value:label,label,description}
//   - [{value,label,description}]           -> all three fields preserved
//   - malformed entries                     -> silently dropped, never crash
//   - description NEVER lost
//   - live AND reload receive the same canonical format
//   - AskUserCard displays label + description, submits value
//   - legacy sessions persisted with string[] OR {label,description} stay
//     readable without DB migration (covered by the AskUserCard guard)

import { describe, expect, it } from 'vitest'
import {
  AskUserInterrupt,
  askUserTool,
  provideAnswer,
  getPendingQuestionsForSession,
} from './ask.js'
import type { ChoiceOption } from '../../shared/protocol.js'

describe('ask_user tool — non-lossy structured options', () => {
  it('canonical: {label, description} -> {value:label,label,description} (description preserved)', async () => {
    let interrupt: AskUserInterrupt | null = null

    try {
      await askUserTool.execute(
        {
          question: 'Pick:',
          type: 'choice',
          options: [
            { label: 'Continuer', description: 'Reprendre le flux principal' },
            { label: 'Annuler', description: 'Stopper ici' },
          ],
        },
        {
          workdir: '/tmp/project',
          sessionId: 'session-canonical',
          sessionManager: {} as never,
          toolCallId: 'call-canonical',
        },
      )
    } catch (error) {
      interrupt = error as AskUserInterrupt
    }

    expect(interrupt).toBeInstanceOf(AskUserInterrupt)
    // CRITICAL: description must survive the boundary normalization.
    expect(interrupt?.options).toEqual<ChoiceOption[]>([
      { value: 'Continuer', label: 'Continuer', description: 'Reprendre le flux principal' },
      { value: 'Annuler', label: 'Annuler', description: 'Stopper ici' },
    ])

    // Same canonical shape must flow into getPendingQuestionsForSession
    // (which feeds session.state.pendingQuestions on reload).
    const pending = getPendingQuestionsForSession('session-canonical')
    expect(pending.length).toBe(1)
    expect(pending[0]?.options).toEqual<ChoiceOption[]>([
      { value: 'Continuer', label: 'Continuer', description: 'Reprendre le flux principal' },
      { value: 'Annuler', label: 'Annuler', description: 'Stopper ici' },
    ])

    provideAnswer('call-canonical', 'Continuer')
  })

  it('canonical: {value, label, description} -> all three fields preserved verbatim', async () => {
    let interrupt: AskUserInterrupt | null = null

    try {
      await askUserTool.execute(
        {
          question: 'Pick:',
          type: 'choice',
          options: [
            { value: 'yes-v', label: 'Oui', description: 'Accepter' },
            { value: 'no-v', label: 'Non', description: 'Refuser' },
          ],
        },
        {
          workdir: '/tmp/project',
          sessionId: 'session-triple',
          sessionManager: {} as never,
          toolCallId: 'call-triple',
        },
      )
    } catch (error) {
      interrupt = error as AskUserInterrupt
    }

    expect(interrupt?.options).toEqual<ChoiceOption[]>([
      { value: 'yes-v', label: 'Oui', description: 'Accepter' },
      { value: 'no-v', label: 'Non', description: 'Refuser' },
    ])

    provideAnswer('call-triple', 'yes-v')
  })

  it('legacy: string[] -> {value:s,label:s} with description omitted', async () => {
    let interrupt: AskUserInterrupt | null = null

    try {
      await askUserTool.execute(
        { question: 'Pick:', type: 'choice', options: ['A', 'B', 'C'] },
        {
          workdir: '/tmp/project',
          sessionId: 'session-legacy',
          sessionManager: {} as never,
          toolCallId: 'call-legacy',
        },
      )
    } catch (error) {
      interrupt = error as AskUserInterrupt
    }

    // Every entry must carry a `value` and a `label`. description is OMITTED
    // (not undefined-as-a-key, just absent) when not provided — this matches
    // exactOptionalPropertyTypes.
    expect(interrupt?.options).toEqual<ChoiceOption[]>([
      { value: 'A', label: 'A' },
      { value: 'B', label: 'B' },
      { value: 'C', label: 'C' },
    ])
    for (const opt of interrupt?.options ?? []) {
      expect('description' in opt).toBe(false)
    }

    provideAnswer('call-legacy', 'A')
  })

  it('malformed entries are silently dropped; never produce crashes nor raw objects', async () => {
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
            'legacy-string-entry',
            { value: 'has-only-value' }, // no label → dropped
            { value: 'with-label-too', label: 'Yes' },
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

    expect(interrupt?.options).toEqual<ChoiceOption[]>([
      { value: 'OK', label: 'OK' },
      { value: 'legacy-string-entry', label: 'legacy-string-entry' },
      { value: 'with-label-too', label: 'Yes' },
    ])
    // Every emitted option must be a structured object with string value/label,
    // never a raw string/array/object leaking through.
    for (const opt of interrupt?.options ?? []) {
      expect(typeof opt).toBe('object')
      expect(opt).not.toBeNull()
      expect(typeof (opt as ChoiceOption).value).toBe('string')
      expect(typeof (opt as ChoiceOption).label).toBe('string')
    }

    provideAnswer('call-malformed', 'OK')
  })

  it('returns undefined when every entry is malformed (no usable choice)', async () => {
    let interrupt: AskUserInterrupt | null = null

    try {
      await askUserTool.execute(
        {
          question: 'Pick:',
          type: 'choice',
          options: [null, undefined, 42, { label: '' }, { description: 'no label' }, { value: 'no-label' }],
        } as unknown as Parameters<typeof askUserTool.execute>[0],
        {
          workdir: '/tmp/project',
          sessionId: 'session-all-malformed',
          sessionManager: {} as never,
          toolCallId: 'call-all-malformed',
        },
      )
    } catch (error) {
      interrupt = error as AskUserInterrupt
    }

    expect(interrupt?.options).toBeUndefined()
  })

  it('live AND reload parity: getPendingQuestionsForSession returns the same canonical shape as the live interrupt', async () => {
    let interrupt: AskUserInterrupt | null = null

    try {
      await askUserTool.execute(
        {
          question: 'Pick:',
          type: 'choice',
          options: [{ label: 'Oui', description: 'Accepter' }, 'Non'],
        },
        {
          workdir: '/tmp/project',
          sessionId: 'session-parity',
          sessionManager: {} as never,
          toolCallId: 'call-parity',
        },
      )
    } catch (error) {
      interrupt = error as AskUserInterrupt
    }

    const pending = getPendingQuestionsForSession('session-parity')

    // LIVE path: the thrown AskUserInterrupt
    expect(interrupt?.options).toEqual<ChoiceOption[]>([
      { value: 'Oui', label: 'Oui', description: 'Accepter' },
      { value: 'Non', label: 'Non' },
    ])

    // RELOAD path: session.state.pendingQuestions coming from in-memory store
    // (this is exactly what /api/sessions/:id and the WS session.state message
    // return to the client on a reload).
    expect(pending.length).toBe(1)
    expect(pending[0]?.options).toEqual<ChoiceOption[]>([
      { value: 'Oui', label: 'Oui', description: 'Accepter' },
      { value: 'Non', label: 'Non' },
    ])

    // The two paths must produce IDENTICAL shapes (deep-equal).
    expect(pending[0]?.options).toEqual(interrupt?.options)

    provideAnswer('call-parity', 'Oui')
  })

  it('description NEVER lost across mixed-shape inputs', async () => {
    // Regression for the rejected commit 5674623 which dropped description
    // by collapsing to string[]. We re-feed a mix of shapes and assert
    // description-bearing entries survive end-to-end.
    let interrupt: AskUserInterrupt | null = null

    try {
      await askUserTool.execute(
        {
          question: 'Pick:',
          type: 'choice',
          options: [
            'plain-string',
            { label: 'Has-desc', description: 'I have a description' },
            { value: 'with-all', label: 'WithAll', description: 'Triple field entry' },
          ],
        },
        {
          workdir: '/tmp/project',
          sessionId: 'session-mix',
          sessionManager: {} as never,
          toolCallId: 'call-mix',
        },
      )
    } catch (error) {
      interrupt = error as AskUserInterrupt
    }

    const opts = interrupt?.options
    expect(opts?.length).toBe(3)
    // Find the entries that carried a description upstream.
    const withDesc = opts?.filter((o) => o.description !== undefined)
    expect(withDesc?.length).toBe(2)
    expect(withDesc?.[0]?.description).toBe('I have a description')
    expect(withDesc?.[1]?.description).toBe('Triple field entry')

    provideAnswer('call-mix', 'plain-string')
  })
})