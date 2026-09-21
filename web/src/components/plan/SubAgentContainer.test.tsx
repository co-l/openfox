// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContextState, Message } from '@shared/types.js'

const { contextStateFixture } = vi.hoisted(() => ({
  contextStateFixture: { subAgentContextStates: {} as Record<string, ContextState | undefined> },
}))

vi.mock('../../hooks/useAgents', () => ({
  useAgents: () => ({ agents: [{ id: 'code_reviewer', name: 'Code Reviewer' }], refresh: vi.fn() }),
}))

vi.mock('../../stores/session', () => ({
  useSessionStore: (
    selector: (state: { subAgentContextStates: Record<string, ContextState | undefined> }) => unknown,
  ) => selector(contextStateFixture),
}))

vi.mock('../../hooks/useDisplaySettings', () => ({
  useDisplaySettings: () => ({ showThinking: false, showVerboseToolOutput: false }),
}))

vi.mock('../../hooks/useAutoScroll', () => ({
  useAutoScroll: () => ({ isAutoScrollActive: false, setAutoScroll: vi.fn() }),
}))

vi.mock('./AssistantMessage', () => ({
  AssistantMessage: ({ message }: { message: Message }) => (
    <article data-testid="subagent-message">{message.content}</article>
  ),
}))

vi.mock('./ChatMessage', () => ({
  ChatMessage: ({ message }: { message: Message }) => (
    <article data-testid="subagent-message">{message.content}</article>
  ),
}))

import { SubAgentContainer } from './SubAgentContainer'

function makeContextState(overrides: Partial<ContextState> = {}): ContextState {
  return {
    currentTokens: 42511,
    maxTokens: 500000,
    compactionCount: 0,
    dangerZone: false,
    canCompact: false,
    dynamicContextChanged: false,
    ...overrides,
  }
}

function setSubAgentContext(state: ContextState | undefined) {
  contextStateFixture.subAgentContextStates = { 'code-reviewer-run-1': state }
}

const messages: Message[] = [
  {
    id: 'm1',
    role: 'assistant' as const,
    content: 'Review findings',
    timestamp: new Date(1_700_000_000_000).toISOString(),
    subAgentId: 'code-reviewer-run-1',
    subAgentType: 'code_reviewer',
  },
]

function renderContainer() {
  return render(
    <SubAgentContainer
      messages={messages}
      subAgentType="code_reviewer"
      subAgentId="code-reviewer-run-1"
      isStreaming={false}
    />,
  )
}

afterEach(cleanup)

describe('SubAgentContainer', () => {
  it('renders the context bar in normal flow instead of an absolute overlay', () => {
    setSubAgentContext(makeContextState())
    renderContainer()

    const header = screen.getByTestId('subagent-header')
    const slot = screen.getByTestId('subagent-context-bar-slot')

    expect(slot).not.toHaveClass('absolute')
    expect(header).not.toHaveClass('relative')
    expect(slot.parentElement).toBe(header)
    expect(slot).toHaveTextContent('42 511/500 000')
  })

  it('omits the context bar when no sub-agent context state exists', () => {
    setSubAgentContext(undefined)
    renderContainer()

    expect(screen.queryByTestId('subagent-context-bar-slot')).toBeNull()
  })

  it('does not render a compaction badge when the sub-agent compaction count is zero', () => {
    setSubAgentContext(makeContextState({ compactionCount: 0 }))
    renderContainer()

    expect(screen.queryByText('0x')).toBeNull()
    expect(screen.getByTestId('subagent-context-bar-slot')).toBeInTheDocument()
  })

  it('renders the compaction badge from the sub-agent own compaction count', () => {
    setSubAgentContext(makeContextState({ compactionCount: 4 }))
    renderContainer()

    expect(screen.getByText('4x')).toBeInTheDocument()
  })

  it('renders a "context summarized" divider before the compaction summary message', () => {
    const withCompaction: Message[] = [
      {
        id: 'm1',
        role: 'assistant' as const,
        content: 'Findings before compaction',
        timestamp: new Date(1_700_000_000_000).toISOString(),
        subAgentId: 'code-reviewer-run-1',
        subAgentType: 'code_reviewer',
      },
      {
        id: 'm-summary',
        role: 'assistant' as const,
        content: 'Earlier context summary',
        timestamp: new Date(1_700_000_000_100).toISOString(),
        subAgentId: 'code-reviewer-run-1',
        subAgentType: 'code_reviewer',
        isCompactionSummary: true,
      },
      {
        id: 'm2',
        role: 'assistant' as const,
        content: 'Continuing after compaction',
        timestamp: new Date(1_700_000_000_200).toISOString(),
        subAgentId: 'code-reviewer-run-1',
        subAgentType: 'code_reviewer',
      },
    ]

    render(
      <SubAgentContainer
        messages={withCompaction}
        subAgentType="code_reviewer"
        subAgentId="code-reviewer-run-1"
        isStreaming={false}
      />,
    )

    const divider = screen.getByTestId('subagent-compaction-divider')
    expect(divider).toBeInTheDocument()

    const summary = screen.getByText('Earlier context summary')
    expect(divider.compareDocumentPosition(summary)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('does not render a compaction divider when no compaction summary is present', () => {
    renderContainer()

    expect(screen.queryByTestId('subagent-compaction-divider')).toBeNull()
  })
})
