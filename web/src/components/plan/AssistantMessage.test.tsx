// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

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

const { criteriaGroupMock } = vi.hoisted(() => ({ criteriaGroupMock: vi.fn() }))

vi.mock('../shared/CriteriaGroupDisplay', () => ({
  CriteriaGroupDisplay: (props: unknown) => {
    criteriaGroupMock(props)
    return <div>criteria</div>
  },
  isCriterionTool: () => false,
}))

import type { Message } from '@shared/types.js'
import type { TurnStats } from '../../lib/types'
import { AssistantMessage } from './AssistantMessage'
import { TurnStatsModal } from './TurnStatsModal'

function StatsDetailHarness({ message }: { message: Message }) {
  const [stats, setStats] = useState<TurnStats | null>(null)

  useEffect(() => {
    const handler = (event: Event) => setStats((event as CustomEvent<{ stats: TurnStats }>).detail.stats)
    window.addEventListener('open-turn-stats', handler)
    return () => window.removeEventListener('open-turn-stats', handler)
  }, [])

  return (
    <>
      <AssistantMessage message={message} />
      {stats && <TurnStatsModal stats={stats} onClose={() => setStats(null)} />}
    </>
  )
}

afterEach(cleanup)

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

  it('shows the reasoning effort suffix in the stats bar when present', () => {
    const html = renderToStaticMarkup(
      <AssistantMessage
        message={{
          id: 'assistant-effort',
          role: 'assistant',
          content: '',
          timestamp: '2024-01-01T00:00:00.000Z',
          tokenCount: 0,
          isStreaming: false,
          stats: {
            providerId: 'openai',
            providerName: 'OpenAI',
            backend: 'openai',
            model: 'deepseek-v4-flash',
            reasoningEffort: 'high',
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

    expect(html).toContain('deepseek-v4-flash:high')
  })

  it('omits the effort suffix from the stats bar when none is set', () => {
    const html = renderToStaticMarkup(
      <AssistantMessage
        message={{
          id: 'assistant-no-effort',
          role: 'assistant',
          content: '',
          timestamp: '2024-01-01T00:00:00.000Z',
          tokenCount: 0,
          isStreaming: false,
          stats: {
            providerId: 'openai',
            providerName: 'OpenAI',
            backend: 'openai',
            model: 'deepseek-v4-flash',
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

    expect(html).toContain('deepseek-v4-flash')
    expect(html).not.toContain('deepseek-v4-flash:')
  })

  it('renders persisted messages with null usage stats', () => {
    const message = {
      id: 'assistant-null-stats',
      role: 'assistant',
      content: 'Persisted answer',
      timestamp: '2024-01-01T00:00:00.000Z',
      tokenCount: 0,
      isStreaming: false,
      stats: {
        providerId: 'openai',
        providerName: 'OpenAI',
        backend: 'openai',
        model: 'MiniMax-M3',
        mode: 'builder',
        totalTime: 1702.319,
        toolTime: 1681.938,
        prefillTokens: null,
        prefillSpeed: null,
        generationTokens: null,
        generationSpeed: null,
      },
    } as unknown as Message

    const html = renderToStaticMarkup(<AssistantMessage message={message} />)

    expect(html).toContain('Persisted answer')
    expect(html).toContain('— pp')
    expect(html).toContain('— tg')
    expect(html).not.toContain('0 @ 0.0')
  })

  it('routes in-flight metadata adds into the criteria group instead of a preparing card', () => {
    criteriaGroupMock.mockClear()
    const message: Message = {
      id: 'assistant-add',
      role: 'assistant',
      content: '',
      timestamp: '2024-01-01T00:00:00.000Z',
      tokenCount: 0,
      isStreaming: true,
      preparingToolCalls: [
        {
          index: 0,
          name: 'session_metadata',
          arguments: JSON.stringify({ action: 'add', key: 'criteria', description: 'Do the thing' }),
        },
      ],
    }
    render(<AssistantMessage message={message} />)
    expect(screen.queryByText('tool preparing')).toBeNull()
    expect(criteriaGroupMock).toHaveBeenCalled()
    const props = criteriaGroupMock.mock.calls[0]![0] as {
      toolCalls: unknown[]
      preparing: unknown[]
    }
    expect(props.toolCalls).toEqual([])
    expect(props.preparing).toHaveLength(1)
  })

  it('keeps non-add preparing calls as regular preparing cards', () => {
    criteriaGroupMock.mockClear()
    const message: Message = {
      id: 'assistant-read',
      role: 'assistant',
      content: '',
      timestamp: '2024-01-01T00:00:00.000Z',
      tokenCount: 0,
      isStreaming: true,
      preparingToolCalls: [
        { index: 0, name: 'session_metadata', arguments: JSON.stringify({ action: 'get', key: 'criteria' }) },
      ],
    }
    render(<AssistantMessage message={message} />)
    expect(screen.getByText('tool preparing')).toBeTruthy()
    expect(criteriaGroupMock).not.toHaveBeenCalled()
  })

  it('opens stats details for persisted messages with null usage stats', () => {
    const message = {
      id: 'assistant-null-stats',
      role: 'assistant',
      content: 'Persisted answer',
      timestamp: '2024-01-01T00:00:00.000Z',
      tokenCount: 0,
      isStreaming: false,
      stats: {
        providerId: 'openai',
        providerName: 'OpenAI',
        backend: 'openai',
        model: 'MiniMax-M3',
        mode: 'builder',
        totalTime: 1702.319,
        toolTime: 1681.938,
        prefillTokens: null,
        prefillSpeed: null,
        generationTokens: null,
        generationSpeed: null,
      },
    } as unknown as Message

    render(<StatsDetailHarness message={message} />)
    fireEvent.click(screen.getByTitle('View detailed stats'))

    const dialogText = screen.getByRole('dialog').textContent ?? ''
    expect(dialogText).toContain('Turn Stats')
    expect(dialogText).toContain('MiniMax-M3 · builder')
    expect(dialogText).toContain('Prefill—')
    expect(dialogText).toContain('Generated—')
    expect(dialogText).not.toContain('null')
  })

  it('does not break hook order when re-rendering from an empty message to a content message', () => {
    const emptyMessage: Message = {
      id: 'assistant-empty',
      role: 'assistant',
      content: '',
      timestamp: '2024-01-01T00:00:00.000Z',
      tokenCount: 0,
      isStreaming: false,
    }
    const contentMessage: Message = {
      id: 'assistant-content',
      role: 'assistant',
      content: 'Hello there',
      timestamp: '2024-01-01T00:00:00.000Z',
      tokenCount: 0,
      isStreaming: false,
    }

    const { rerender } = render(<AssistantMessage message={emptyMessage} />)

    expect(() => rerender(<AssistantMessage message={contentMessage} />)).not.toThrow()
    expect(screen.getByText('Hello there')).toBeTruthy()
  })

  it('shows the message timestamp in the right-click menu', () => {
    render(
      <AssistantMessage
        sessionId="s1"
        message={{
          id: 'assistant-1',
          role: 'assistant',
          content: 'Hello there',
          timestamp: '2026-08-16T14:44:00',
          tokenCount: 0,
          isStreaming: false,
        }}
      />,
    )
    const feedItem = screen.getByText('Hello there').closest('.feed-item')
    expect(feedItem).not.toBeNull()
    fireEvent.contextMenu(feedItem!)
    expect(screen.getByText('2026/08/16 14:44')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '2026/08/16 14:44' })).toBeNull()
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
