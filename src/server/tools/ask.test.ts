import { describe, expect, it } from 'vitest'
import { AskUserInterrupt, askUserTool, cancelQuestion, hasPendingQuestion, provideAnswer } from './ask.js'

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
})
