import { describe, expect, it, vi } from 'vitest'
import { createClientMessage, createServerMessage, isClientMessage, isServerMessage } from './protocol.js'

describe('shared protocol helpers', () => {
  it('creates client and server messages', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-1111-1111-111111111111')

    expect(createClientMessage('ask.answer', { callId: 'c1', answer: 'yes' })).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      type: 'ask.answer',
      payload: { callId: 'c1', answer: 'yes' },
    })

    expect(createServerMessage('chat.done', { messageId: 'm1', reason: 'complete' })).toEqual({
      type: 'chat.done',
      payload: { messageId: 'm1', reason: 'complete' },
    })
    expect(createServerMessage('error', { code: 'BAD', message: 'oops' }, 'corr-1')).toEqual({
      id: 'corr-1',
      type: 'error',
      payload: { code: 'BAD', message: 'oops' },
    })
  })

  it('validates client and server message shapes', () => {
    expect(isClientMessage({ id: '1', type: 'ask.answer', payload: {} })).toBe(true)
    expect(isClientMessage({ type: 'ask.answer', payload: {} })).toBe(false)
    expect(isClientMessage(null)).toBe(false)

    expect(isServerMessage({ type: 'chat.done', payload: {} })).toBe(true)
    expect(isServerMessage({ id: '1', type: 'chat.done' })).toBe(false)
    expect(isServerMessage('bad')).toBe(false)
  })
})
