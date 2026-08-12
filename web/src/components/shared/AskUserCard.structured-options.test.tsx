// Red tests for AskUserCard's structured-options contract on the web side.
//
// The server now produces `ChoiceOption[]` (value/label/description) for the
// canonical path, and AskUserCard must:
//   - render label + description
//   - submit `value` (scalar) on click
//   - tolerate legacy `string[]` and `[{label,description}]` payloads already
//     persisted by older builds (without DB migration)
//   - tolerate malformed entries without crash

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { fireEvent } from '@testing-library/react'
import type { ToolCall } from '@shared/types.js'
import { AskUserCard } from './AskUserCard'
import { useSessionStore } from '../../stores/session'
import type { ChoiceOption } from '@shared/protocol.js'

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'call-1',
    name: 'ask_user',
    arguments: { question: 'Test question?' },
    result: undefined,
    ...overrides,
  } as ToolCall
}

function render(ui: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  flushSync(() => root.render(ui))
  return container
}

beforeEach(() => {
  useSessionStore.setState({ pendingQuestions: [] })
  document.body.innerHTML = ''
})

describe('AskUserCard — structured ChoiceOption[] reload parity', () => {
  it('renders label + description when pendingQuestion carries canonical ChoiceOption[] (reload path)', () => {
    const options: ChoiceOption[] = [
      { value: 'yes-v', label: 'Oui', description: 'Accepter' },
      { value: 'no-v', label: 'Non', description: 'Refuser' },
    ]
    useSessionStore.setState({
      pendingQuestions: [{ callId: 'call-1', question: 'Pick:', type: 'choice', options }],
    })
    const tc = makeToolCall({ arguments: { question: 'Pick:' } })
    const container = render(<AskUserCard toolCall={tc} />)
    expect(container.textContent).toContain('Oui')
    expect(container.textContent).toContain('Non')
    expect(container.textContent).toContain('Accepter')
    expect(container.textContent).toContain('Refuser')
    expect(container.textContent).not.toContain('[object Object]')
  })

  it('click submits `value`, not label', () => {
    const answerQuestion = vi.fn()
    const options: ChoiceOption[] = [{ value: 'yes-v', label: 'Oui', description: 'Accepter' }]
    useSessionStore.setState({
      currentSession: { id: 'session-1', projectId: 'p1' } as never,
      pendingQuestions: [{ callId: 'call-1', question: 'Pick:', type: 'choice', options }],
      answerQuestion,
    })
    const tc = makeToolCall({ arguments: { question: 'Pick:' } })
    const container = render(<AskUserCard toolCall={tc} />)
    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Oui'))
    expect(button).toBeDefined()
    fireEvent.click(button!)
    expect(answerQuestion).toHaveBeenCalledTimes(1)
    const [, , value] = answerQuestion.mock.calls[0]!
    expect(typeof value).toBe('string')
    expect(value).toBe('yes-v') // <- the `value`, NOT the `label`
  })

  it('legacy string[] still renders (no DB migration required)', () => {
    useSessionStore.setState({
      pendingQuestions: [
        {
          callId: 'call-1',
          question: 'Pick:',
          type: 'choice',
          options: ['A', 'B'] as unknown as ChoiceOption[],
        },
      ],
    })
    const tc = makeToolCall({ arguments: { question: 'Pick:' } })
    const container = render(<AskUserCard toolCall={tc} />)
    expect(container.textContent).toContain('A')
    expect(container.textContent).toContain('B')
    expect(container.textContent).not.toContain('[object Object]')
  })

  it('legacy [{label, description}] still renders (no DB migration required)', () => {
    // Pre-fix legacy persisted shape — the AskUserCard defensive guard must
    // handle it without DB migration.
    useSessionStore.setState({
      pendingQuestions: [
        {
          callId: 'call-1',
          question: 'Pick:',
          type: 'choice',
          options: [
            { label: 'Continuer', description: 'Reprendre' },
            { label: 'Annuler', description: 'Stopper' },
          ] as unknown as ChoiceOption[],
        },
      ],
    })
    const tc = makeToolCall({ arguments: { question: 'Pick:' } })
    const container = render(<AskUserCard toolCall={tc} />)
    expect(container.textContent).toContain('Continuer')
    expect(container.textContent).toContain('Annuler')
    expect(container.textContent).toContain('Reprendre')
    expect(container.textContent).toContain('Stopper')
    expect(container.textContent).not.toContain('[object Object]')
  })

  it('live streaming: toolCall.arguments carries ChoiceOption[] AND pendingQuestion is set', () => {
    // Models the live path where the tool call arguments already include the
    // canonical shape and the pendingQuestion store is populated from
    // session.state.
    const options: ChoiceOption[] = [{ value: 'yes-v', label: 'Oui', description: 'Accepter' }]
    useSessionStore.setState({
      pendingQuestions: [{ callId: 'call-1', question: 'Pick:', type: 'choice', options }],
    })
    const tc = makeToolCall({
      arguments: {
        question: 'Pick:',
        type: 'choice',
        options,
      },
    })
    const container = render(<AskUserCard toolCall={tc} />)
    expect(container.textContent).toContain('Oui')
    expect(container.textContent).toContain('Accepter')
    expect(container.textContent).not.toContain('[object Object]')
  })

  it('does not crash on null options', () => {
    useSessionStore.setState({
      pendingQuestions: [{ callId: 'call-1', question: 'Pick:', type: 'choice', options: undefined }],
    })
    const tc = makeToolCall({ arguments: { question: 'Pick:', type: 'choice', options: null } })
    const container = render(<AskUserCard toolCall={tc} />)
    // Falls back to text input — no crash.
    expect(container.textContent).toContain('Send')
    expect(container.textContent).toContain('Skip')
  })
})
