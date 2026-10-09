// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '@shared/types.js'

vi.mock('../../hooks/useAgents', () => ({
  useAgents: () => ({ agents: [{ id: 'scout', name: 'Scout' }], refresh: vi.fn() }),
}))

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: { subAgentContextStates: Record<string, never> }) => unknown) =>
    selector({ subAgentContextStates: {} }),
}))

vi.mock('../../hooks/useDisplaySettings', () => ({
  useDisplaySettings: () => ({ showThinking: true, showVerboseToolOutput: true }),
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

const REFERENCE_LLM_CALLS = 311

function referenceMessages(): Message[] {
  return Array.from({ length: REFERENCE_LLM_CALLS }, (_, index) => ({
    id: `subagent-message-${index}`,
    role: 'assistant' as const,
    content: `Sub-agent output ${index + 1}`,
    timestamp: new Date(1_700_000_000_000 + index).toISOString(),
    subAgentId: 'scout-run-1',
    subAgentType: 'scout',
    isStreaming: false,
  }))
}

afterEach(cleanup)

describe('SubAgentContainer long-session rendering', () => {
  it('mounts no message nodes while collapsed', () => {
    render(
      <SubAgentContainer
        messages={referenceMessages()}
        subAgentType="scout"
        subAgentId="scout-run-1"
        isStreaming={false}
      />,
    )

    // A collapsed group must not carry its message history in the DOM: on big
    // sessions a 100-item feed window can contain dozens of sub-agent runs,
    // and mounting all of their histories is what froze the main thread.
    expect(screen.queryAllByTestId('subagent-message')).toHaveLength(0)
  })

  it('mounts the full history on first expand and keeps it mounted when collapsed again', () => {
    render(
      <SubAgentContainer
        messages={referenceMessages()}
        subAgentType="scout"
        subAgentId="scout-run-1"
        isStreaming={false}
      />,
    )

    act(() => {
      screen.getByRole('button', { name: /expand/i }).click()
    })

    expect(screen.getAllByTestId('subagent-message')).toHaveLength(REFERENCE_LLM_CALLS)
    expect(screen.getByText('Sub-agent output 1')).toBeInTheDocument()
    expect(screen.getByText(`Sub-agent output ${REFERENCE_LLM_CALLS}`)).toBeInTheDocument()

    // Collapsing again must not unmount the history (no re-parse/re-highlight
    // churn when the user toggles the group back and forth).
    act(() => {
      screen.getByRole('button', { name: /expand/i }).click()
    })
    expect(screen.getAllByTestId('subagent-message')).toHaveLength(REFERENCE_LLM_CALLS)
  })
})
