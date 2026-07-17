// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '@shared/types.js'

vi.mock('../../stores/agents', () => ({
  useAgentsStore: (selector: (state: { defaults: Array<{ id: string; name: string }>; userItems: [] }) => unknown) =>
    selector({ defaults: [{ id: 'scout', name: 'Scout' }], userItems: [] }),
  getAgentColor: () => '#8b5cf6',
}))

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: { subAgentContextStates: Record<string, never> }) => unknown) =>
    selector({ subAgentContextStates: {} }),
}))

vi.mock('../../stores/settings', () => ({
  useDisplaySettings: () => ({ showThinking: true, showVerboseToolOutput: true }),
}))

vi.mock('../../hooks/useAutoScroll', () => ({
  useAutoScroll: () => ({ isAutoScrollActive: false, setAutoScroll: vi.fn() }),
}))

vi.mock('./AssistantMessage', () => ({
  AssistantMessage: ({ message }: { message: Message }) => <article data-testid="subagent-message">{message.content}</article>,
}))

vi.mock('./ChatMessage', () => ({
  ChatMessage: ({ message }: { message: Message }) => <article data-testid="subagent-message">{message.content}</article>,
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
  it('mounts only the latest message while collapsed, then mounts full history on explicit expand', () => {
    render(
      <SubAgentContainer
        messages={referenceMessages()}
        subAgentType="scout"
        subAgentId="scout-run-1"
        isStreaming={false}
      />,
    )

    expect(screen.getAllByTestId('subagent-message')).toHaveLength(1)
    expect(screen.getByText(`Sub-agent output ${REFERENCE_LLM_CALLS}`)).toBeInTheDocument()
    expect(screen.queryByText('Sub-agent output 1')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /expand/i }))

    expect(screen.getAllByTestId('subagent-message')).toHaveLength(REFERENCE_LLM_CALLS)
    expect(screen.getByText('Sub-agent output 1')).toBeInTheDocument()
  })
})
