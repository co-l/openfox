// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { sanitizeFilename, formatConversationMarkdown, downloadFile, exportConversation } from './export-conversation'
import type { Message, Session } from '@shared/types.js'

describe('export-conversation', () => {
  describe('sanitizeFilename', () => {
    it('cleans invalid characters', () => {
      expect(sanitizeFilename('My / Great : File * Name?')).toBe('My_Great_File_Name_')
      expect(sanitizeFilename('SimpleName')).toBe('SimpleName')
    })
  })

  describe('formatConversationMarkdown', () => {
    it('formats metadata, user message, assistant message with thinking, tool calls, and sub-agents', () => {
      const session: Partial<Session> = {
        id: 'sess-123',
        projectId: 'proj-abc',
        workdir: '/dev/app',
        providerId: 'provider-1',
        providerModel: 'gpt-4o',
        mode: 'build',
        createdAt: '2026-09-01T10:00:00.000Z',
        metadata: {
          title: 'Fix issue with login',
          totalTokensUsed: 100,
          totalToolCalls: 2,
          iterationCount: 1,
        },
      }

      const messages: Message[] = [
        {
          id: 'm1',
          role: 'user',
          content: 'Hello, please inspect the files.',
          timestamp: '2026-09-01T10:01:00.000Z',
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'I will explore the codebase.',
          thinkingContent: 'Need to run ls tool.',
          timestamp: '2026-09-01T10:02:00.000Z',
          toolCalls: [
            {
              id: 'tc1',
              name: 'run_command',
              arguments: { command: 'ls' },
              result: {
                success: true,
                output: 'src\npackage.json',
                durationMs: 12,
                truncated: false,
              },
            },
          ],
        },
        {
          id: 'm3',
          role: 'assistant',
          subAgentId: 'sub-1',
          subAgentType: 'explorer',
          content: 'Explorer found files.',
          timestamp: '2026-09-01T10:03:00.000Z',
          toolCalls: [
            {
              id: 'tc2',
              name: 'read_file',
              arguments: { path: 'src/index.ts' },
              result: {
                success: false,
                error: 'File not found',
                durationMs: 5,
                truncated: false,
              },
            },
          ],
        },
      ]

      const md = formatConversationMarkdown(session, messages)

      expect(md).toContain('# Fix issue with login')
      expect(md).toContain('**Session ID:** `sess-123`')
      expect(md).toContain('**Model:** `gpt-4o` (provider-1)')
      expect(md).toContain('### 👤 User')
      expect(md).toContain('Hello, please inspect the files.')
      expect(md).toContain('### 🤖 Assistant')
      expect(md).toContain('> **Thinking:**')
      expect(md).toContain('Need to run ls tool.')
      expect(md).toContain('#### 🛠️ Tool: `run_command`')
      expect(md).toContain('"command": "ls"')
      expect(md).toContain('src\npackage.json')
      expect(md).toContain('### 🤖 Sub-Agent [explorer] (`sub-1`)')
      expect(md).toContain('Explorer found files.')
      expect(md).toContain('#### 🛠️ Tool: `read_file`')
      expect(md).toContain('Error: File not found')
    })
  })

  describe('downloadFile & exportConversation', () => {
    let createObjectURLMock: ReturnType<typeof vi.fn>
    let revokeObjectURLMock: ReturnType<typeof vi.fn>
    let clickMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
      createObjectURLMock = vi.fn(() => 'blob:mock-url')
      revokeObjectURLMock = vi.fn()
      global.URL.createObjectURL = createObjectURLMock as unknown as typeof URL.createObjectURL
      global.URL.revokeObjectURL = revokeObjectURLMock as unknown as typeof URL.revokeObjectURL

      clickMock = vi.fn()
      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName === 'a') {
          return {
            href: '',
            download: '',
            click: clickMock,
          } as unknown as HTMLAnchorElement
        }
        return document.createElement(tagName)
      })
      vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node)
      vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node)
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('downloads file correctly via DOM anchor element', () => {
      downloadFile('test content', 'file.md')
      expect(createObjectURLMock).toHaveBeenCalled()
      expect(clickMock).toHaveBeenCalled()
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-url')
    })

    it('fetches full session data and exports conversation', async () => {
      const mockSession = { id: 's1', metadata: { title: 'Test Session' } }
      const mockMessages = [{ id: 'm1', role: 'user', content: 'test' }] as Message[]

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ session: mockSession, messages: mockMessages }),
      })

      await exportConversation('s1')

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions/s1?full=true'),
        expect.anything(),
      )
      expect(clickMock).toHaveBeenCalled()
    })
  })
})
