// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: { currentSession: { criteria: [] } }) => unknown) =>
    selector({ currentSession: { criteria: [] } }),
}))

vi.mock('../shared/Markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock('../shared/ThinkingBlock', () => ({
  ThinkingBlock: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock('../shared/ToolCallDisplay', () => ({
  ToolCallDisplay: () => <div>tool call</div>,
}))

vi.mock('../shared/ToolCallPreparing', () => ({
  ToolCallPreparing: () => <div>tool preparing</div>,
}))

vi.mock('../shared/TodoListDisplay', () => ({
  TodoListDisplay: () => <div>todo</div>,
}))

vi.mock('../shared/CriteriaGroupDisplay', () => ({
  CriteriaGroupDisplay: () => <div>criteria</div>,
  isCriterionTool: () => false,
}))

import { AssistantMessage } from './AssistantMessage'

describe('AssistantMessage', () => {
  it('renders an Aborted badge for partial assistant messages', () => {
    const html = renderToStaticMarkup(
      <AssistantMessage
        message={{
          id: 'assistant-1',
          role: 'assistant',
          content: 'Partial answer',
          timestamp: '2024-01-01T00:00:00.000Z',
          tokenCount: 0,
          isStreaming: false,
          partial: true,
        }}
      />,
    )

    expect(html).toContain('Aborted')
    expect(html).not.toContain('Interrupted')
  })

  it('displays the full model name in stats (no hyphen truncation)', () => {
    const html = renderToStaticMarkup(
      <AssistantMessage
        message={{
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: '2024-01-01T00:00:00.000Z',
          tokenCount: 0,
          isStreaming: false,
          stats: {
            providerId: 'openai',
            providerName: 'OpenAI',
            backend: 'openai',
            model: 'deepseek-v4-flash-dspark',
            mode: 'planner',
            totalTime: 3.2,
            toolTime: 0.5,
            prefillTokens: 8600,
            prefillSpeed: 11500,
            generationTokens: 124,
            generationSpeed: 50.2,
          },
        }}
      />,
    )

    expect(html).toContain('deepseek-v4-flash-dspark')
    // Should NOT truncate to first 2 hyphen-segments only
    expect(html).not.toContain('>deepseek-v4<')
  })

  it('strips provider path prefix from model name', () => {
    const html = renderToStaticMarkup(
      <AssistantMessage
        message={{
          id: 'assistant-2',
          role: 'assistant',
          content: '',
          timestamp: '2024-01-01T00:00:00.000Z',
          tokenCount: 0,
          isStreaming: false,
          stats: {
            providerId: 'my-provider',
            providerName: 'My Provider',
            backend: 'openai',
            model: 'my-provider/deepseek-v4-flash-dspark',
            mode: 'builder',
            totalTime: 5.0,
            toolTime: 1.0,
            prefillTokens: 1000,
            prefillSpeed: 1000,
            generationTokens: 50,
            generationSpeed: 25,
          },
        }}
      />,
    )

    expect(html).toContain('deepseek-v4-flash-dspark')
    expect(html).not.toContain('my-provider/')
  })

})
