import { describe, it, expect, vi, afterEach } from 'vitest'
import type { MinimalMessage } from '../chat/request-context.js'
import {
  checkHeadroomAvailability,
  checkHeadroomProxy,
  getHeadroomProxyUrl,
  isHeadroomEnabled,
  compressMessagesWithHeadroom,
  toHeadroomMessages,
  fromHeadroomMessages,
  DEFAULT_HEADROOM_URL,
} from './client.js'
import * as dbSettings from '../db/settings.js'

describe('headroom/client', () => {
  describe('getHeadroomProxyUrl and isHeadroomEnabled', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('returns default URL when setting is unset', () => {
      vi.spyOn(dbSettings, 'getSetting').mockReturnValue(null)
      expect(getHeadroomProxyUrl()).toBe(DEFAULT_HEADROOM_URL)
    })

    it('returns custom URL when configured', () => {
      vi.spyOn(dbSettings, 'getSetting').mockReturnValue('http://localhost:9000/')
      expect(getHeadroomProxyUrl()).toBe('http://localhost:9000')
    })

    it('checks if headroom is enabled', () => {
      vi.spyOn(dbSettings, 'getSetting').mockReturnValue('true')
      expect(isHeadroomEnabled()).toBe(true)

      vi.spyOn(dbSettings, 'getSetting').mockReturnValue('false')
      expect(isHeadroomEnabled()).toBe(false)
    })
  })

  describe('checkHeadroomProxy', () => {
    const originalFetch = globalThis.fetch

    afterEach(() => {
      globalThis.fetch = originalFetch
      vi.restoreAllMocks()
    })

    it('returns true when /health responds with healthy', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy' }),
      } as any)

      const running = await checkHeadroomProxy('http://127.0.0.1:8787')
      expect(running).toBe(true)
    })

    it('returns false when fetch fails', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection error'))
      const running = await checkHeadroomProxy('http://127.0.0.1:8787')
      expect(running).toBe(false)
    })

    it('returns availability status correctly', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy' }),
      } as any)

      const status = await checkHeadroomAvailability('http://127.0.0.1:8787')
      expect(status.running).toBe(true)
      expect(status.available).toBe(true)
      expect(status.proxyUrl).toBe('http://127.0.0.1:8787')
    })
  })

  describe('toHeadroomMessages and fromHeadroomMessages', () => {
    it('converts MinimalMessages to OpenAI message format and back', () => {
      const messages: MinimalMessage[] = [
        { role: 'user', content: 'Hello world' },
        {
          role: 'assistant',
          content: 'Let me run a tool',
          toolCalls: [{ id: 'call_1', name: 'run_command', arguments: { command: 'ls' } }],
        },
        {
          role: 'tool',
          toolCallId: 'call_1',
          content: 'file1.txt\nfile2.txt',
        },
      ]

      const converted = toHeadroomMessages(messages)
      expect(converted).toEqual([
        { role: 'user', content: 'Hello world' },
        {
          role: 'assistant',
          content: 'Let me run a tool',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'run_command', arguments: JSON.stringify({ command: 'ls' }) },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: 'file1.txt\nfile2.txt',
        },
      ])

      const back = fromHeadroomMessages(converted, messages)
      expect(back[0]?.content).toBe('Hello world')
      expect(back[1]?.toolCalls).toEqual([{ id: 'call_1', name: 'run_command', arguments: { command: 'ls' } }])
      expect(back[2]?.toolCallId).toBe('call_1')
      expect(back[2]?.content).toBe('file1.txt\nfile2.txt')
    })

    it('preserves role parity and does not attach mismatched role metadata', () => {
      const original: MinimalMessage[] = [
        {
          role: 'user',
          content: 'Hello',
          attachments: [{ id: 'a1', filename: 'doc.pdf', mimeType: 'application/pdf', size: 100, data: 'base64' }],
        },
        {
          role: 'assistant',
          content: 'I will think',
          thinkingContent: 'deep thought',
          toolCalls: [{ id: 'call_1', name: 'search', arguments: {} }],
        },
      ]

      // Suppose proxy changed message order or roles
      const compressed: any[] = [
        { role: 'assistant', content: 'compressed assistant' },
        { role: 'user', content: 'compressed user' },
      ]

      const back = fromHeadroomMessages(compressed, original)
      expect(back[0]?.role).toBe('assistant')
      // orig[0] was 'user' with attachments -> should NOT attach to assistant
      expect(back[0]?.attachments).toBeUndefined()

      expect(back[1]?.role).toBe('user')
      // orig[1] was 'assistant' with thinkingContent/toolCalls -> should NOT attach to user
      expect(back[1]?.thinkingContent).toBeUndefined()
      expect(back[1]?.toolCalls).toBeUndefined()
    })
  })

  describe('compressMessagesWithHeadroom', () => {
    const originalFetch = globalThis.fetch

    afterEach(() => {
      globalThis.fetch = originalFetch
      vi.restoreAllMocks()
    })

    it('returns compressed messages when proxy responds with 200', async () => {
      const messages: MinimalMessage[] = [
        { role: 'user', content: 'Summarize results' },
        { role: 'tool', toolCallId: 't1', content: 'long output 123456789' },
      ]

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          messages: [
            { role: 'user', content: 'Summarize results' },
            { role: 'tool', tool_call_id: 't1', content: 'compressed output' },
          ],
          tokens_before: 100,
          tokens_after: 40,
          tokens_saved: 60,
          compression_ratio: 0.4,
          transforms_applied: ['smart_crusher'],
        }),
      } as any)

      const result = await compressMessagesWithHeadroom({
        messages,
        model: 'gpt-4o',
        headroomUrl: 'http://127.0.0.1:8787',
        frozenMessageCount: 1,
      })

      expect(result.compressed).toBe(true)
      expect(result.tokensSaved).toBe(60)
      expect(result.compressionRatio).toBe(0.4)
      expect(result.messages[1]?.content).toBe('compressed output')
    })

    it('fails open when proxy fetch fails or throws', async () => {
      const messages: MinimalMessage[] = [{ role: 'user', content: 'Hello' }]

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'))

      const result = await compressMessagesWithHeadroom({
        messages,
        model: 'gpt-4o',
        headroomUrl: 'http://127.0.0.1:8787',
      })

      expect(result.compressed).toBe(false)
      expect(result.tokensSaved).toBe(0)
      expect(result.messages).toEqual(messages)
    })

    it('fails open when proxy returns HTTP error status', async () => {
      const messages: MinimalMessage[] = [{ role: 'user', content: 'Hello' }]

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      } as any)

      const result = await compressMessagesWithHeadroom({
        messages,
        model: 'gpt-4o',
        headroomUrl: 'http://127.0.0.1:8787',
      })

      expect(result.compressed).toBe(false)
      expect(result.messages).toEqual(messages)
    })
  })
})
