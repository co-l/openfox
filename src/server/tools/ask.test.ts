import { describe, expect, it } from 'vitest'
import {
  AskUserInterrupt,
  askUserTool,
  cancelQuestion,
  cancelQuestionsForSession,
  hasPendingQuestion,
  provideAnswer,
} from './ask.js'

describe('ask_user tool', () => {
  it('throws an AskUserInterrupt and tracks the pending question', async () => {
    let interrupt: AskUserInterrupt | null = null

    try {
      await askUserTool.execute({ question: 'Which backend should I use?' }, {
        workdir: '/tmp/project',
        sessionId: 'session-1',
        sessionManager: {} as never,
      })
    } catch (error) {
      interrupt = error as AskUserInterrupt
    }

    expect(interrupt).toBeInstanceOf(AskUserInterrupt)
    expect(interrupt?.question).toBe('Which backend should I use?')
    expect(interrupt?.callId).toBeTruthy()
    expect(interrupt && hasPendingQuestion(interrupt.callId)).toBe(true)
    expect(provideAnswer(interrupt!.callId, 'Use vLLM')).toBe(true)
    expect(hasPendingQuestion(interrupt!.callId)).toBe(false)
  })

  it('cancels pending questions and returns false for unknown ids', async () => {
    let interrupt: AskUserInterrupt | null = null

    try {
      await askUserTool.execute({ question: 'Need approval?' }, {
        workdir: '/tmp/project',
        sessionId: 'session-1',
        sessionManager: {} as never,
      })
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

    for (const sessionId of ['session-1', 'session-1', 'session-2']) {
      try {
        await askUserTool.execute({ question: `Question for ${sessionId}` }, {
          workdir: '/tmp/project',
          sessionId,
          sessionManager: {} as never,
        })
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
})
