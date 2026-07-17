// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CriteriaEditor } from './CriteriaEditor'
import { authFetch } from '../../lib/api'

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))),
}))

vi.mock('../../stores/agents', () => ({
  useAgentsStore: vi.fn(
    (selector: (state: { defaults: unknown[]; userItems: unknown[]; projectItems: unknown[] }) => unknown) =>
      selector({ defaults: [], userItems: [], projectItems: [] }),
  ),
  getAgentColor: vi.fn(() => '#000000'),
}))

vi.mock('../../stores/workflows', () => ({
  useWorkflowsStore: vi.fn((selector: (state: { defaults: unknown[]; userItems: unknown[] }) => unknown) =>
    selector({ defaults: [], userItems: [] }),
  ),
}))

const mockedAuthFetch = vi.mocked(authFetch)

function openAddInput() {
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  return screen.getByPlaceholderText('New criterion...')
}

describe('CriteriaEditor', () => {
  afterEach(cleanup)

  beforeEach(() => {
    mockedAuthFetch.mockClear()
  })

  it('creates one pending criterion per non-empty pasted line in one request', () => {
    render(<CriteriaEditor entries={[]} sessionId="session-1" />)
    const input = openAddInput()

    fireEvent.paste(input, {
      clipboardData: {
        getData: () => ' First criterion \r\n\r\nSecond criterion\n Third criterion ',
      },
    })

    expect(screen.getByText('[0] First criterion')).toBeInTheDocument()
    expect(screen.getByText('[1] Second criterion')).toBeInTheDocument()
    expect(screen.getByText('[2] Third criterion')).toBeInTheDocument()
    expect(input).toHaveValue('')
    expect(mockedAuthFetch).toHaveBeenCalledTimes(1)
    expect(mockedAuthFetch).toHaveBeenCalledWith('/api/sessions/session-1/criteria', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        criteria: [
          { id: '0', description: 'First criterion', status: 'pending' },
          { id: '1', description: 'Second criterion', status: 'pending' },
          { id: '2', description: 'Third criterion', status: 'pending' },
        ],
      }),
    })
  })

  it('keeps a single-line paste as normal input without creating a criterion', () => {
    render(<CriteriaEditor entries={[]} sessionId="session-1" />)
    const input = openAddInput()

    fireEvent.paste(input, {
      clipboardData: {
        getData: () => 'Single criterion',
      },
    })

    expect(mockedAuthFetch).not.toHaveBeenCalled()
    expect(screen.queryByText('[0] Single criterion')).not.toBeInTheDocument()
  })

  it('keeps the existing Enter-to-add behavior', () => {
    render(<CriteriaEditor entries={[]} sessionId="session-1" />)
    const input = openAddInput()

    fireEvent.change(input, { target: { value: 'Added with Enter' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByText('[0] Added with Enter')).toBeInTheDocument()
    expect(mockedAuthFetch).toHaveBeenCalledTimes(1)
  })

  it('allocates pasted IDs after the greatest existing numeric ID', () => {
    render(
      <CriteriaEditor
        sessionId="session-1"
        entries={[
          { id: '0', description: 'Existing zero', status: 'pending' },
          { id: '2', description: 'Existing two', status: 'pending' },
          { id: 'custom', description: 'Existing custom', status: 'pending' },
        ]}
      />,
    )
    const input = openAddInput()

    fireEvent.paste(input, {
      clipboardData: {
        getData: () => 'New one\nNew two',
      },
    })

    expect(screen.getByText('[3] New one')).toBeInTheDocument()
    expect(screen.getByText('[4] New two')).toBeInTheDocument()
  })
})
