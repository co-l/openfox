// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolCall } from '@shared/types.js'
import { CriteriaGroupDisplay } from './CriteriaGroupDisplay'

vi.mock('./Markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}))

function tc(name: string, args: Record<string, unknown>, output?: string): ToolCall {
  return {
    id: `tc-${Math.random().toString(36).slice(2)}`,
    name,
    arguments: args,
    result: output !== undefined ? { success: true, output, durationMs: 5, truncated: false } : undefined,
  }
}

afterEach(cleanup)

describe('CriteriaGroupDisplay', () => {
  it('renders list output instead of a "Criterion updated" placeholder', () => {
    const calls = [
      tc('session_metadata', { action: 'list' }, 'Metadata keys:\n- criteria (3 items)\n- todos (2 items)'),
    ]
    render(<CriteriaGroupDisplay toolCalls={calls} />)
    expect(screen.getByText(/Metadata keys:/)).toBeTruthy()
    expect(screen.getByText(/- criteria \(3 items\)/)).toBeTruthy()
    expect(screen.getByText(/- todos \(2 items\)/)).toBeTruthy()
    expect(screen.queryByText('Criterion updated')).toBeNull()
  })

  it('renders a compact confirmation for a schema call instead of the raw output', () => {
    const calls = [
      tc(
        'session_metadata',
        { action: 'schema', key: 'criteria' },
        'Key: criteria\nDescription: Acceptance criteria that drive workflow transitions',
      ),
    ]
    render(<CriteriaGroupDisplay toolCalls={calls} />)
    expect(screen.getByText(/Schema loaded for 'criteria' metadata/)).toBeTruthy()
    expect(screen.queryByText(/Key: criteria/)).toBeNull()
    expect(screen.queryByText(/Description: Acceptance criteria/)).toBeNull()
    expect(screen.queryByText('Criterion updated')).toBeNull()
  })

  it('renders parsed entries for a get with JSON output', () => {
    const calls = [
      tc(
        'session_metadata',
        { action: 'get', key: 'criteria' },
        JSON.stringify([
          { id: '0', description: 'First thing', status: 'pending' },
          { id: '1', description: 'Second thing', status: 'pending' },
        ]),
      ),
    ]
    render(<CriteriaGroupDisplay toolCalls={calls} />)
    expect(screen.getByText('[0] First thing')).toBeTruthy()
    expect(screen.getByText('[1] Second thing')).toBeTruthy()
  })

  it('renders plain text for a get with non-JSON output', () => {
    const calls = [tc('session_metadata', { action: 'get', key: 'criteria' }, 'No entries for key "criteria".')]
    render(<CriteriaGroupDisplay toolCalls={calls} />)
    expect(screen.getByText('No entries for key "criteria".')).toBeTruthy()
    expect(screen.queryByText('Criterion updated')).toBeNull()
  })

  it('renders an add mutation as a description row', () => {
    const calls = [
      tc('session_metadata', { action: 'add', key: 'criteria', description: 'Brand new criterion', status: 'pending' }),
    ]
    render(<CriteriaGroupDisplay toolCalls={calls} />)
    expect(screen.getByText('Brand new criterion')).toBeTruthy()
    expect(screen.queryByText('Criterion updated')).toBeNull()
  })

  it('strikes through a removed item', () => {
    const calls = [tc('session_metadata', { action: 'remove', key: 'criteria', id: '0', description: 'Old thing' })]
    render(<CriteriaGroupDisplay toolCalls={calls} />)
    const el = screen.getByText('Old thing')
    expect(el.parentElement?.className).toContain('line-through')
  })

  it('shows the reason for a failed item', () => {
    const calls = [
      tc('session_metadata', {
        action: 'fail',
        key: 'criteria',
        id: '0',
        description: 'Some criterion',
        reason: 'Not met',
      }),
    ]
    render(<CriteriaGroupDisplay toolCalls={calls} />)
    expect(screen.getByText('Some criterion')).toBeTruthy()
    expect(screen.getByText(/Not met/)).toBeTruthy()
  })

  it('renders both reads and mutations within a single group', () => {
    const calls = [
      tc('session_metadata', { action: 'list' }, 'Metadata keys:\n- criteria (1 items)'),
      tc('session_metadata', { action: 'add', key: 'criteria', description: 'Brand new criterion', status: 'pending' }),
    ]
    render(<CriteriaGroupDisplay toolCalls={calls} />)
    expect(screen.getByText(/Metadata keys:/)).toBeTruthy()
    expect(screen.getByText('Brand new criterion')).toBeTruthy()
    expect(screen.queryByText('Criterion updated')).toBeNull()
  })

  it('preserves the execution order of reads and mutations within a group', () => {
    const calls = [
      tc('session_metadata', { action: 'add', key: 'criteria', description: 'First add', status: 'pending' }),
      tc('session_metadata', { action: 'list' }, 'Metadata keys:\n- criteria (1 items)'),
      tc('session_metadata', { action: 'add', key: 'criteria', description: 'Second add', status: 'pending' }),
    ]
    const { container } = render(<CriteriaGroupDisplay toolCalls={calls} />)
    const text = container.textContent ?? ''
    expect(text.indexOf('First add')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('First add')).toBeLessThan(text.indexOf('Metadata keys:'))
    expect(text.indexOf('Metadata keys:')).toBeLessThan(text.indexOf('Second add'))
  })

  it('renders a muted row for a failed read instead of vanishing', () => {
    const calls = [
      {
        ...tc('session_metadata', { action: 'list' }),
        result: { success: false, error: 'Not permitted', durationMs: 5, truncated: false },
      },
    ]
    render(<CriteriaGroupDisplay toolCalls={calls} />)
    expect(screen.getByText(/Not permitted/)).toBeTruthy()
  })

  it('renders a muted row for an output-less read instead of vanishing', () => {
    const calls = [tc('session_metadata', { action: 'list' })]
    render(<CriteriaGroupDisplay toolCalls={calls} />)
    expect(screen.getByText(/No output/)).toBeTruthy()
  })
})
