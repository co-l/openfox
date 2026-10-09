// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: { currentSession: { criteria: [] } }) => unknown) =>
    selector({ currentSession: { criteria: [] } }),
}))

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(() => Promise.reject(new Error('network disabled in tests'))),
  forkSession: vi.fn(),
  forkSessionErrorMessage: vi.fn(),
}))

vi.mock('../shared/Markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock('../shared/ThinkingBlock', () => ({
  ThinkingBlock: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock('../shared/ThinkingBlockToggle', () => ({
  ThinkingBlockToggle: (props: unknown) => {
    thinkingBlockToggleMock(props)
    return <div>thinking-block-toggle</div>
  },
}))

vi.mock('../shared/ToolCallDisplay', () => ({
  ToolCallDisplay: (props: unknown) => {
    toolCallDisplayMock(props)
    return <div>tool call</div>
  },
}))

vi.mock('../shared/AskUserCard', () => ({
  AskUserCard: (props: unknown) => {
    askUserCardMock(props)
    return <div>ask-user-card</div>
  },
}))

vi.mock('../shared/ToolCallPreparing', () => ({
  ToolCallPreparing: (props: unknown) => {
    toolCallPreparingMock(props)
    return <div>tool preparing</div>
  },
}))

vi.mock('../shared/TodoListDisplay', () => ({
  TodoListDisplay: () => <div>todo</div>,
}))

const { criteriaGroupMock, toolCallPreparingMock, thinkingBlockToggleMock, toolCallDisplayMock, askUserCardMock } =
  vi.hoisted(() => ({
    criteriaGroupMock: vi.fn(),
    toolCallPreparingMock: vi.fn(),
    thinkingBlockToggleMock: vi.fn(),
    toolCallDisplayMock: vi.fn(),
    askUserCardMock: vi.fn(),
  }))

vi.mock('../shared/CriteriaGroupDisplay', () => ({
  CriteriaGroupDisplay: (props: unknown) => {
    criteriaGroupMock(props)
    return <div>criteria</div>
  },
  isCriterionTool: () => false,
}))

import type { Message, ToolCall } from '@shared/types.js'
import type { TurnStats } from '../../lib/types'
import { latchMessageEnd, latchToolCallEnd } from '../../lib/block-timing'
import { formatClockTime } from '../../lib/format-date'
import { AssistantMessage } from './AssistantMessage'
import { TurnStatsModal } from './TurnStatsModal'
import { SETTINGS_KEYS, settingResource } from '../../lib/resources'
import { clearCache } from '../../lib/resourceCache'

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

  it('renders a collapsed toggle when showThinking is off', () => {
    thinkingBlockToggleMock.mockClear()
    render(
      <AssistantMessage
        showThinking={false}
        message={{
          id: 'assistant-hide-thinking',
          role: 'assistant',
          content: 'Answer',
          thinkingContent: 'secret reasoning',
          timestamp: '2024-01-01T00:00:00.000Z',
          isStreaming: false,
        }}
      />,
    )

    expect(screen.queryByText('secret reasoning')).toBeNull()
    expect(thinkingBlockToggleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'assistant-hide-thinking',
        content: 'secret reasoning',
        isStreaming: false,
        thinkingFinished: true,
        showThinking: false,
      }),
    )
  })

  it('renders the toggle for a message that only contains thinking', () => {
    thinkingBlockToggleMock.mockClear()
    render(
      <AssistantMessage
        showThinking={false}
        message={{
          id: 'assistant-only-thinking',
          role: 'assistant',
          content: '',
          thinkingContent: 'only reasoning',
          timestamp: '2024-01-01T00:00:00.000Z',
          isStreaming: true,
        }}
      />,
    )

    expect(screen.queryByText('only reasoning')).toBeNull()
    expect(thinkingBlockToggleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'assistant-only-thinking',
        isStreaming: true,
        thinkingFinished: false,
        showThinking: false,
      }),
    )
  })

  it('passes the persisted thinking duration to the toggle', () => {
    thinkingBlockToggleMock.mockClear()
    render(
      <AssistantMessage
        showThinking={false}
        message={{
          id: 'assistant-thinking-stats',
          role: 'assistant',
          content: 'Answer',
          thinkingContent: 'reasoning',
          timestamp: '2024-01-01T00:00:00.000Z',
          isStreaming: false,
          stats: {
            providerId: 'openai',
            providerName: 'OpenAI',
            backend: 'openai',
            model: 'deepseek-v4-flash',
            mode: 'planner',
            totalTime: 160,
            toolTime: 0,
            prefillTokens: 10,
            prefillSpeed: 10,
            generationTokens: 10,
            generationSpeed: 10,
            thinkingDuration: 160,
          },
        }}
      />,
    )

    expect(thinkingBlockToggleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'assistant-thinking-stats',
        thinkingFinished: true,
        thinkingDuration: 160,
      }),
    )
  })

  it('passes the full thinking content when showThinking is on', () => {
    thinkingBlockToggleMock.mockClear()
    render(
      <AssistantMessage
        message={{
          id: 'assistant-show-thinking',
          role: 'assistant',
          content: 'Answer',
          thinkingContent: 'visible reasoning',
          timestamp: '2024-01-01T00:00:00.000Z',
          isStreaming: false,
        }}
      />,
    )

    expect(thinkingBlockToggleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'assistant-show-thinking',
        content: 'visible reasoning',
        showThinking: true,
      }),
    )
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

  it('passes forceCompact to preparing cards matching the expanded-output setting', () => {
    toolCallPreparingMock.mockClear()
    const message: Message = {
      id: 'assistant-write',
      role: 'assistant',
      content: '',
      timestamp: '2024-01-01T00:00:00.000Z',
      tokenCount: 0,
      isStreaming: true,
      preparingToolCalls: [
        { index: 0, name: 'write_file', arguments: JSON.stringify({ path: 'src/a.ts', content: 'const x = 1' }) },
      ],
    }

    render(<AssistantMessage message={message} showVerboseToolOutput />)
    expect(toolCallPreparingMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'write_file', forceCompact: false }),
    )

    toolCallPreparingMock.mockClear()
    render(<AssistantMessage message={message} showVerboseToolOutput={false} />)
    expect(toolCallPreparingMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'write_file', forceCompact: true }),
    )
  })

  it('passes the live edit context from preparing calls to the preparing card', () => {
    toolCallPreparingMock.mockClear()
    const editContext = [
      {
        startLine: 3,
        endLine: 3,
        beforeContext: [{ lineNumber: 2, content: 'line two' }],
        afterContext: [{ lineNumber: 4, content: 'line four' }],
        oldContent: 'a',
        newContent: 'b',
        edits: [{ startLine: 3, endLine: 3, oldContent: 'a', newContent: 'b' }],
      },
    ]
    const message: Message = {
      id: 'assistant-edit',
      role: 'assistant',
      content: '',
      timestamp: '2024-01-01T00:00:00.000Z',
      tokenCount: 0,
      isStreaming: true,
      preparingToolCalls: [
        {
          index: 0,
          name: 'edit_file',
          arguments: JSON.stringify({ path: 'src/a.ts', old_string: 'a', new_string: 'b' }),
          editContext,
        },
      ],
    }

    render(<AssistantMessage message={message} />)
    expect(toolCallPreparingMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'edit_file', editContext }))
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

describe('AssistantMessage block end timestamps', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the latched message end time under the answer text', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    latchMessageEnd('msg-end')

    const { container } = render(
      <AssistantMessage
        message={{
          id: 'msg-end',
          role: 'assistant',
          content: 'Hello there',
          timestamp: '2026-08-16T14:44:00',
          isStreaming: false,
        }}
      />,
    )

    expect(container.textContent).toContain(formatClockTime(1_000_000))
  })

  it('shows no end time under the answer text when nothing was latched', () => {
    render(
      <AssistantMessage
        message={{
          id: 'msg-no-end',
          role: 'assistant',
          content: 'Hello there',
          timestamp: '2026-08-16T14:44:00',
          isStreaming: false,
        }}
      />,
    )

    expect(screen.queryByTestId('message-end-time')).toBeNull()
  })

  it('shows the end time only under the last text segment of a multi-segment message', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    latchMessageEnd('msg-multi')

    render(
      <AssistantMessage
        message={{
          id: 'msg-multi',
          role: 'assistant',
          content: '',
          segments: [
            { type: 'text', content: 'first part' },
            { type: 'tool_call', toolCallId: 'tc-mid' },
            { type: 'text', content: 'second part' },
          ],
          toolCalls: [
            {
              id: 'tc-mid',
              name: 'run_command',
              arguments: { command: 'ls' },
              result: { success: true, durationMs: 1, truncated: false },
            },
          ],
          timestamp: '2026-08-16T14:44:00',
          isStreaming: false,
        }}
      />,
    )

    const times = screen.getAllByTestId('message-end-time')
    expect(times).toHaveLength(1)
    expect(times[0]!.textContent).toBe(formatClockTime(1_000_000))
    expect(times[0]!.parentElement!.textContent ?? '').toContain('second part')
  })

  it('passes the latched tool call end to the tool call display', () => {
    toolCallDisplayMock.mockClear()

    latchToolCallEnd('tc-end')

    render(
      <AssistantMessage
        message={{
          id: 'msg-tools',
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'tc-end',
              name: 'read_file',
              arguments: { path: 'src/a.ts' },
              result: { success: true, durationMs: 1, truncated: false },
            },
          ],
          timestamp: '2026-08-16T14:44:00',
          isStreaming: false,
        }}
      />,
    )

    expect(toolCallDisplayMock).toHaveBeenCalledWith(expect.objectContaining({ endedAt: expect.any(Number) }))
  })
})

describe('AssistantMessage zen mode', () => {
  beforeEach(() => {
    clearCache()
  })

  afterEach(() => {
    clearCache()
    cleanup()
  })

  const zenOn = () => settingResource.write('true', SETTINGS_KEYS.DISPLAY_ZEN_MODE)

  const messageWithToolCall = (toolCall: ToolCall): Message =>
    ({
      id: 'zen-msg',
      role: 'assistant',
      content: '',
      toolCalls: [toolCall],
      timestamp: '2024-01-01T00:00:00.000Z',
      isStreaming: false,
    }) as Message

  it('hides finished tool calls when zen mode is on', () => {
    toolCallDisplayMock.mockClear()
    zenOn()
    render(
      <AssistantMessage
        message={messageWithToolCall({
          id: 'tc-done',
          name: 'read_file',
          arguments: { path: 'src/a.ts' },
          result: { success: true, durationMs: 5, truncated: false },
        })}
      />,
    )

    expect(toolCallDisplayMock).toHaveBeenCalledWith(expect.objectContaining({ hidden: true }))
  })

  it('keeps running tool calls visible when zen mode is on', () => {
    toolCallDisplayMock.mockClear()
    zenOn()
    render(
      <AssistantMessage
        message={messageWithToolCall({
          id: 'tc-running',
          name: 'run_command',
          arguments: { command: 'ls' },
        })}
      />,
    )

    expect(toolCallDisplayMock).toHaveBeenCalledWith(expect.objectContaining({ hidden: false }))
  })

  it('keeps finished tool calls visible when zen mode is off', () => {
    toolCallDisplayMock.mockClear()
    render(
      <AssistantMessage
        message={messageWithToolCall({
          id: 'tc-zen-off',
          name: 'read_file',
          arguments: { path: 'src/a.ts' },
          result: { success: true, durationMs: 5, truncated: false },
        })}
      />,
    )

    expect(toolCallDisplayMock).toHaveBeenCalledWith(expect.objectContaining({ hidden: false }))
  })

  it('keeps ask_user visible when zen mode is on, pending and answered', () => {
    askUserCardMock.mockClear()
    zenOn()
    render(
      <AssistantMessage
        message={messageWithToolCall({
          id: 'ask-pending',
          name: 'ask_user',
          arguments: { question: 'Which option?' },
        })}
      />,
    )

    expect(askUserCardMock).toHaveBeenCalled()

    askUserCardMock.mockClear()
    render(
      <AssistantMessage
        message={messageWithToolCall({
          id: 'ask-answered',
          name: 'ask_user',
          arguments: { question: 'Which option?' },
          result: { success: true, output: 'option A', durationMs: 1, truncated: false },
        })}
      />,
    )

    expect(askUserCardMock).toHaveBeenCalled()
  })

  it('keeps the message visible when it only contains an answered ask_user', () => {
    zenOn()
    const { container } = render(
      <AssistantMessage
        message={messageWithToolCall({
          id: 'ask-answered-only',
          name: 'ask_user',
          arguments: { question: 'Which option?' },
          result: { success: true, output: 'option A', durationMs: 1, truncated: false },
        })}
      />,
    )

    expect(askUserCardMock).toHaveBeenCalled()
    expect(container.querySelector('.feed-item')?.getAttribute('class')?.split(/\s+/)).not.toContain('hidden')
  })

  it('keeps the todo list visible when zen mode is on', () => {
    zenOn()
    render(
      <AssistantMessage
        message={messageWithToolCall({
          id: 'tc-todos',
          name: 'todo_write',
          arguments: { todos: [] },
          result: { success: true, durationMs: 1, truncated: false },
        })}
      />,
    )

    expect(screen.getByText('todo')).toBeTruthy()
  })

  it('hides the whole message when only finished tool calls remain', () => {
    zenOn()
    const { container } = render(
      <AssistantMessage
        message={messageWithToolCall({
          id: 'tc-only',
          name: 'read_file',
          arguments: { path: 'src/a.ts' },
          result: { success: true, durationMs: 5, truncated: false },
        })}
      />,
    )

    const root = container.querySelector('.feed-item')
    expect(root?.getAttribute('class')?.split(/\s+/)).toContain('hidden')
  })

  it('keeps the message visible when text remains', () => {
    zenOn()
    const { container } = render(
      <AssistantMessage
        message={{
          id: 'zen-text',
          role: 'assistant',
          content: 'Answer text',
          toolCalls: [
            {
              id: 'tc-done-2',
              name: 'read_file',
              arguments: { path: 'src/a.ts' },
              result: { success: true, durationMs: 5, truncated: false },
            },
          ],
          timestamp: '2024-01-01T00:00:00.000Z',
          isStreaming: false,
        }}
      />,
    )

    expect(screen.getByText('Answer text')).toBeTruthy()
    expect(container.querySelector('.feed-item')?.getAttribute('class')?.split(/\s+/)).not.toContain('hidden')
  })

  it('tightens the message gap when zen mode is on', () => {
    zenOn()
    const { container } = render(
      <AssistantMessage
        message={messageWithToolCall({
          id: 'tc-gap-on',
          name: 'run_command',
          arguments: { command: 'ls' },
        })}
      />,
    )

    const classes = container.querySelector('.feed-item')?.getAttribute('class')?.split(/\s+/)
    expect(classes).toContain('mb-2')
    expect(classes).not.toContain('hidden')
  })

  it('keeps the default message gap when zen mode is off', () => {
    const { container } = render(
      <AssistantMessage
        message={messageWithToolCall({
          id: 'tc-gap-off',
          name: 'read_file',
          arguments: { path: 'src/a.ts' },
          result: { success: true, durationMs: 5, truncated: false },
        })}
      />,
    )

    expect(container.querySelector('.feed-item')?.getAttribute('class')?.split(/\s+/)).not.toContain('mb-2')
  })
})
