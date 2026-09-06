// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { fireEvent } from '@testing-library/react'
import type { ToolCall } from '@shared/types.js'
import type { ChoiceOption } from '@shared/protocol.js'
import { AskUserCard } from './AskUserCard'
import { useSessionStore } from '../../stores/session'

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

describe('AskUserCard', () => {
  beforeEach(() => {
    useSessionStore.setState({ pendingQuestions: [] })
    document.body.innerHTML = ''
  })

  it('renders question text from tool call arguments', () => {
    const tc = makeToolCall({ arguments: { question: 'What framework?' } })
    const container = render(<AskUserCard toolCall={tc} />)
    expect(container.textContent).toContain('What framework?')
  })

  it('renders markdown-structured questions without leaking raw syntax', () => {
    const question =
      'Pick a stack:\n1. **Meross** MTS100 — the thermostat\n2. `MSS510` — the light switch\n3. Plugs — metering MSS310 or plain MSS110?'
    const tc = makeToolCall({ arguments: { question } })
    const container = render(<AskUserCard toolCall={tc} />)
    expect(container.textContent).toContain('Meross')
    expect(container.textContent).toContain('MSS510')
    expect(container.textContent).not.toContain('**')
    expect(container.textContent).not.toContain('`MSS510`')
    expect(container.querySelectorAll('li').length).toBeGreaterThanOrEqual(3)
  })

  it('preserves line breaks in multi-part questions', () => {
    const question = 'Two things:\n1. Inventory — which models?\n2. Network — reservations?'
    const tc = makeToolCall({ arguments: { question } })
    const container = render(<AskUserCard toolCall={tc} />)
    const items = Array.from(container.querySelectorAll('li')).map((li) => li.textContent)
    expect(items).toContain('Inventory — which models?')
    expect(items).toContain('Network — reservations?')
  })

  it('shows answered state when tool call has result', () => {
    const tc = makeToolCall({
      result: { success: true, output: 'React', durationMs: 100, truncated: false },
    })
    const container = render(<AskUserCard toolCall={tc} />)
    expect(container.textContent).toContain('Answered')
    expect(container.textContent).toContain('React')
  })

  it('shows "Answered automatically" when the result metadata flags an auto-answer', () => {
    const tc = makeToolCall({
      result: {
        success: true,
        output: 'React',
        durationMs: 100,
        truncated: false,
        metadata: { autoAnswered: true },
      },
    })
    const container = render(<AskUserCard toolCall={tc} />)
    expect(container.textContent).toContain('Answered automatically')
    expect(container.textContent).toContain('React')
  })

  it('shows skipped state when result is [user skipped]', () => {
    const tc = makeToolCall({
      result: { success: true, output: '[user skipped]', durationMs: 100, truncated: false },
    })
    const container = render(<AskUserCard toolCall={tc} />)
    expect(container.textContent).toContain('Skipped')
  })

  it('renders input when question is pending', () => {
    useSessionStore.setState({
      pendingQuestions: [{ callId: 'call-1', question: 'Proceed?', type: 'text', options: undefined }],
    })
    const tc = makeToolCall({ arguments: { question: 'Proceed?' } })
    const container = render(<AskUserCard toolCall={tc} />)
    expect(container.textContent).toContain('Send Answer')
    expect(container.textContent).toContain('Skip')
  })

  it('renders confirm buttons for confirm type', () => {
    useSessionStore.setState({
      pendingQuestions: [{ callId: 'call-1', question: 'Continue?', type: 'confirm', options: undefined }],
    })
    const tc = makeToolCall({ arguments: { question: 'Continue?' } })
    const container = render(<AskUserCard toolCall={tc} />)
    expect(container.textContent).toContain('Yes')
    expect(container.textContent).toContain('No')
    expect(container.textContent).toContain('Skip')
  })

  it('renders choice chips and custom input for choice type', () => {
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
    expect(container.textContent).toContain('Send')
  })

  it('does not crash when options is a string instead of array', () => {
    // LLM sometimes outputs options as a string instead of array — guard against .map() crash
    useSessionStore.setState({
      pendingQuestions: [{ callId: 'call-1', question: 'Pick:', type: 'choice', options: undefined }],
    })
    const tc = makeToolCall({
      arguments: { question: 'Pick:', type: 'choice', options: 'option1, option2' },
    })
    const container = render(<AskUserCard toolCall={tc} />)
    // Should fall through to text input instead of crashing
    expect(container.textContent).toContain('Send')
    expect(container.textContent).toContain('Skip')
  })

  it('does not crash when options is null', () => {
    useSessionStore.setState({
      pendingQuestions: [{ callId: 'call-1', question: 'Pick:', type: 'choice', options: undefined }],
    })
    const tc = makeToolCall({
      arguments: { question: 'Pick:', type: 'choice', options: null },
    })
    const container = render(<AskUserCard toolCall={tc} />)
    expect(container.textContent).toContain('Send')
    expect(container.textContent).toContain('Skip')
  })

  it('renders choice buttons when options contains {label, description} objects (LLM quirk)', () => {
    // Regression for crash React #31: some LLMs emit options as objects with
    // {label, description} instead of plain strings. AskUserCard must coerce
    // them to a renderable label and still emit a scalar value when clicked.
    useSessionStore.setState({
      pendingQuestions: [
        {
          callId: 'call-1',
          question: 'Pick:',
          type: 'choice',
          options: [
            { label: 'Continuer', description: 'Reprendre le flux principal' },
            { label: 'Annuler', description: 'Stopper ici' },
          ] as unknown as ChoiceOption[],
        },
      ],
    })
    const tc = makeToolCall({
      arguments: {
        question: 'Pick:',
        type: 'choice',
        options: [
          { label: 'Continuer', description: 'Reprendre le flux principal' },
          { label: 'Annuler', description: 'Stopper ici' },
        ],
      },
    })
    const container = render(<AskUserCard toolCall={tc} />)
    // Both labels should be rendered, never the raw object.
    expect(container.textContent).toContain('Continuer')
    expect(container.textContent).toContain('Annuler')
    // Should not have the React "[object Object]" fallback or any nested object dump.
    expect(container.textContent).not.toContain('[object Object]')
    expect(container.textContent).not.toContain('description:')
  })

  it('submits the label string (not the object) when an object option is clicked', () => {
    const answerQuestion = vi.fn()
    useSessionStore.setState({
      currentSession: { id: 'session-1', projectId: 'p1' } as never,
      pendingQuestions: [
        {
          callId: 'call-1',
          question: 'Pick:',
          type: 'choice',
          options: [{ label: 'Continuer', description: 'desc' }] as unknown as ChoiceOption[],
        },
      ],
      answerQuestion,
    })
    const tc = makeToolCall({
      arguments: {
        question: 'Pick:',
        type: 'choice',
        options: [{ label: 'Continuer', description: 'desc' }],
      },
    })
    const container = render(<AskUserCard toolCall={tc} />)
    const buttons = container.querySelectorAll('button')
    // First button is the structured option, click it.
    const target = Array.from(buttons).find((b) => b.textContent?.includes('Continuer'))
    expect(target).toBeDefined()
    fireEvent.click(target!)
    // answerQuestion must be called with a stable SCALAR value (string), never the object.
    expect(answerQuestion).toHaveBeenCalledTimes(1)
    const [, , value] = answerQuestion.mock.calls[0]!
    expect(typeof value).toBe('string')
    expect(value).toBe('Continuer')
  })

  it('falls back safely when an option is malformed (neither string nor object)', () => {
    useSessionStore.setState({
      pendingQuestions: [
        {
          callId: 'call-1',
          question: 'Pick:',
          type: 'choice',
          options: [null, undefined, 42, { label: 'OK' }] as unknown as ChoiceOption[],
        },
      ],
    })
    const tc = makeToolCall({
      arguments: {
        question: 'Pick:',
        type: 'choice',
        options: [null, undefined, 42, { label: 'OK' }],
      },
    })
    const container = render(<AskUserCard toolCall={tc} />)
    // Malformed entries should be filtered out, only the well-formed option rendered.
    expect(container.textContent).toContain('OK')
    // No raw object dump, no numeric cast-to-string pollution.
    expect(container.textContent).not.toContain('label:')
    expect(container.textContent).not.toContain('[object Object]')
  })

  it('shows structured options description as a subtitle below the label', () => {
    useSessionStore.setState({
      pendingQuestions: [
        {
          callId: 'call-1',
          question: 'Pick:',
          type: 'choice',
          options: [{ label: 'Continuer', description: 'Reprendre' }] as unknown as ChoiceOption[],
        },
      ],
    })
    const tc = makeToolCall({
      arguments: {
        question: 'Pick:',
        type: 'choice',
        options: [{ label: 'Continuer', description: 'Reprendre' }],
      },
    })
    const container = render(<AskUserCard toolCall={tc} />)
    // Description must be rendered as a separate, well-located element below the label.
    expect(container.textContent).toContain('Continuer')
    expect(container.textContent).toContain('Reprendre')
  })

  it('persistence rehydration: toolCall.arguments holds {label,description} without a pendingQuestion entry', () => {
    // Models a session reload where the persisted toolCall carries structured
    // options in its arguments but no live pendingQuestion (e.g. server already
    // resolved the question, or the client re-rendered after a navigation).
    // The component must still render without crashing.
    const tc = makeToolCall({
      arguments: {
        question: 'Pick:',
        type: 'choice',
        options: [{ label: 'Continuer', description: 'Reprendre' }],
      },
    })
    useSessionStore.setState({ pendingQuestions: [] })
    const container = render(<AskUserCard toolCall={tc} />)
    // No pending question → input area hidden, but question text must render.
    expect(container.textContent).toContain('Pick:')
    expect(container.textContent).not.toContain('[object Object]')
  })

  it('persistence rehydration: pendingQuestion carries object options restored from session.state', () => {
    // Mirrors session.test.ts > restores pendingQuestions from session.state on load:
    // the payload coming from the server may contain structured options.
    useSessionStore.setState({
      pendingQuestions: [
        {
          callId: 'call-1',
          question: 'Pick:',
          type: 'choice',
          options: [{ label: 'Continuer', description: 'desc' }] as unknown as ChoiceOption[],
        },
      ],
    })
    const tc = makeToolCall({
      arguments: { question: 'Pick:' }, // arguments may NOT carry options after restore
    })
    const container = render(<AskUserCard toolCall={tc} />)
    expect(container.textContent).toContain('Continuer')
    expect(container.textContent).toContain('desc')
    expect(container.textContent).not.toContain('[object Object]')
  })

  it('renders the countdown inside the recommended option only, ringed with the accent', () => {
    useSessionStore.setState({
      pendingQuestions: [
        {
          callId: 'call-rec',
          question: 'Pick:',
          type: 'choice',
          options: [
            { value: 'A', label: 'Recommended way' },
            { value: 'B', label: 'Other way' },
          ] as ChoiceOption[],
          autoAnswerDeadline: Date.now() + 5000,
        },
      ],
    })
    const tc = makeToolCall({
      id: 'call-rec',
      arguments: {
        question: 'Pick:',
        type: 'choice',
        options: [
          { value: 'A', label: 'Recommended way' },
          { value: 'B', label: 'Other way' },
        ],
      },
    })
    const container = render(<AskUserCard toolCall={tc} />)
    const countdown = container.querySelector('[data-testid="autoanswer-countdown"]')!
    const recommended = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Recommended way'),
    )!
    const other = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Other way'))!
    expect(recommended).toBeTruthy()
    expect(recommended.className).toContain('shadow-[0_0')
    expect(recommended.contains(countdown)).toBe(true)
    expect(other.className).not.toMatch(/(^|\s)border-accent-primary(\s|$)/)
    expect(other.contains(countdown)).toBe(false)
  })
  it('submits answer on Enter', () => {
    const answerQuestion = vi.fn()
    useSessionStore.setState({
      currentSession: { id: 'session-1', projectId: 'p1' } as never,
      pendingQuestions: [{ callId: 'call-1', question: 'Proceed?', type: 'text', options: undefined }],
      answerQuestion,
    })
    const tc = makeToolCall({ arguments: { question: 'Proceed?' } })
    const container = render(<AskUserCard toolCall={tc} />)
    const textarea = container.querySelector('textarea')!
    fireEvent.change(textarea, { target: { value: 'my answer' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(answerQuestion).toHaveBeenCalledWith('session-1', 'call-1', 'my answer')
  })

  it('does not submit on Shift+Enter', () => {
    const answerQuestion = vi.fn()
    useSessionStore.setState({
      pendingQuestions: [{ callId: 'call-1', question: 'Proceed?', type: 'text', options: undefined }],
      answerQuestion,
    })
    const tc = makeToolCall({ arguments: { question: 'Proceed?' } })
    const container = render(<AskUserCard toolCall={tc} />)
    const textarea = container.querySelector('textarea')!
    fireEvent.change(textarea, { target: { value: 'my answer' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(answerQuestion).not.toHaveBeenCalled()
  })

  it('skips question on Escape', () => {
    const answerQuestion = vi.fn()
    useSessionStore.setState({
      currentSession: { id: 'session-1', projectId: 'p1' } as never,
      pendingQuestions: [{ callId: 'call-1', question: 'Proceed?', type: 'text', options: undefined }],
      answerQuestion,
    })
    const tc = makeToolCall({ arguments: { question: 'Proceed?' } })
    const container = render(<AskUserCard toolCall={tc} />)
    const textarea = container.querySelector('textarea')!
    fireEvent.keyDown(textarea, { key: 'Escape' })
    expect(answerQuestion).toHaveBeenCalledWith('session-1', 'call-1', '', true)
  })

  it('renders duplicate-value options without duplicate React key warnings', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      useSessionStore.setState({
        pendingQuestions: [
          {
            callId: 'call-1',
            question: 'Pick:',
            type: 'choice',
            options: [
              { value: 'dup', label: 'First' },
              { value: 'dup', label: 'Second' },
            ],
          },
        ],
      })
      const tc = makeToolCall({ arguments: { question: 'Pick:' } })
      const container = render(<AskUserCard toolCall={tc} />)
      expect(container.textContent).toContain('First')
      expect(container.textContent).toContain('Second')
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })
})

describe('AskUserCard auto-answer countdown', () => {
  it('renders the countdown and typing an answer cancels it', async () => {
    const wsSend = vi.spyOn((await import('../../lib/ws')).wsClient, 'send').mockImplementation(() => 'id')
    const deadline = Date.now() + 120_000
    useSessionStore.setState({
      pendingQuestions: [
        {
          callId: 'call-aa',
          question: 'Pick:',
          type: 'choice',
          options: [{ value: 'A', label: 'A' }] as ChoiceOption[],
          autoAnswerDeadline: deadline,
        },
      ],
    })
    const tc = makeToolCall({ id: 'call-aa', arguments: { question: 'Pick:', type: 'choice' } })
    const container = render(<AskUserCard toolCall={tc} />)
    expect(container.textContent).toContain('auto-answer')

    const textarea = container.querySelector('textarea')!
    fireEvent.change(textarea, { target: { value: 'custom' } })

    expect(wsSend).toHaveBeenCalledWith('chat.cancel_autoanswer', expect.objectContaining({}))
    const question = useSessionStore.getState().pendingQuestions.find((q) => q.callId === 'call-aa')!
    expect(question.autoAnswerDeadline).toBeUndefined()
    wsSend.mockRestore()
  })
})
