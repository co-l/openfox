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

vi.mock('../shared/CriteriaGroupDisplay', () => ({
  CriteriaGroupDisplay: () => <div>criteria</div>,
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
