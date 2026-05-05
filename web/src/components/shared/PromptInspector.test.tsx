import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PromptInspector } from './PromptInspector'

vi.mock('./SelfContainedModal', () => ({
  Modal: ({ isOpen, title, children }: { isOpen: boolean; title: string; children: ReactNode }) =>
    isOpen ? <div data-title={title}>{children}</div> : null,
}))

describe('PromptInspector', () => {
  it('renders exact request messages and tools when present', () => {
    const html = renderToStaticMarkup(
      <PromptInspector
        isOpen
        onClose={() => undefined}
        promptContext={{
          systemPrompt: 'system prompt',
          userMessage: 'Do the thing',
          injectedFiles: [{ path: 'AGENTS.md', content: 'rules', source: 'agents-md' }],
          messages: [
            {
              role: 'user',
              content: 'Do the thing',
              source: 'history',
              attachments: [{ id: 'att-1', filename: 'mock.png', mimeType: 'image/png', size: 10, data: 'ZmFrZQ==' }],
            },
            { role: 'user', content: 'Runtime state', source: 'runtime' },
          ],
          tools: [{ name: 'read_file', description: 'Read a file', parameters: { path: { type: 'string' } } }],
          requestOptions: { toolChoice: 'auto', disableThinking: false },
        }}
      />,
    )

    expect(html).toContain('Prompt Messages (2)')
    expect(html).toContain('Tools (1)')
    expect(html).toContain('Request Options')
    expect(html).toContain('runtime')
    expect(html).toContain('read_file')
    expect(html).toContain('mock.png')
  })
})
