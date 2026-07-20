// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MetadataModal } from './MetadataModal'
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

function renderModal(
  overrides: Partial<{
    entries: { id: string; description: string; status: string }[]
    sessionId: string
    metadataKey: string
    title: string
    isOpen: boolean
    onClose: () => void
  }> = {},
) {
  const defaultProps = {
    entries: [
      { id: '0', description: 'First item', status: 'open' },
      { id: '1', description: 'Second item', status: 'resolved' },
    ],
    sessionId: 'session-1',
    metadataKey: 'review_findings',
    title: 'Review Findings',
    isOpen: true,
    onClose: vi.fn(),
    ...overrides,
  }
  return render(<MetadataModal {...defaultProps} />)
}

describe('MetadataModal', () => {
  afterEach(() => {
    cleanup()
    mockedAuthFetch.mockClear()
  })

  // ── Criterion 0: Click to open ──────────────────────────────────────
  describe('Criterion 0 — Click to open', () => {
    it('renders nothing when isOpen is false', () => {
      render(
        <MetadataModal
          isOpen={false}
          onClose={vi.fn()}
          entries={[]}
          sessionId="s1"
          metadataKey="todos"
          title="Tasks"
        />,
      )
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('renders the modal when isOpen is true', () => {
      renderModal()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  // ── Criterion 1: Full-screen modal ──────────────────────────────────
  describe('Criterion 1 — Full-screen modal', () => {
    it('uses size="full" class for 95vw × 90vh', () => {
      renderModal()
      const dialog = screen.getByRole('dialog')
      expect(dialog.className).toContain('max-w-[95vw]')
      expect(dialog.className).toContain('h-[90vh]')
    })

    it('has scrollable content area', () => {
      renderModal()
      const scrollContainer = screen.getByRole('dialog').querySelector('.overflow-y-auto')
      expect(scrollContainer).toBeInTheDocument()
    })
  })

  // ── Criterion 2: Full display without truncation ────────────────────
  describe('Criterion 2 — Full display without truncation', () => {
    it('does not apply truncate class to entry descriptions', () => {
      renderModal()
      const entryElements = screen.getAllByText(/First item|Second item/)
      entryElements.forEach((el) => {
        expect(el.className).not.toContain('truncate')
      })
    })

    it('shows full description text without cutting it off', () => {
      const longText = 'A very long description that should not be truncated in the modal view ' + 'x'.repeat(200)
      renderModal({ entries: [{ id: '0', description: longText, status: 'open' }] })
      expect(screen.getByText(longText)).toBeInTheDocument()
    })
  })

  // ── Criterion 3: Status cycling ─────────────────────────────────────
  describe('Criterion 3 — Status cycling', () => {
    it('cycles review_findings statuses: open → resolved → dismissed → open', () => {
      renderModal({ metadataKey: 'review_findings' })
      const statusIcon = screen.getAllByTitle(/click to cycle/i)[0]!
      fireEvent.click(statusIcon)
      expect(mockedAuthFetch).toHaveBeenCalledTimes(1)
      const firstCallArgs = JSON.parse(mockedAuthFetch.mock.calls[0]![1]!.body as string)
      expect(firstCallArgs.entries[0].status).toBe('resolved')

      fireEvent.click(statusIcon)
      expect(mockedAuthFetch).toHaveBeenCalledTimes(2)
      const secondCallArgs = JSON.parse(mockedAuthFetch.mock.calls[1]![1]!.body as string)
      expect(secondCallArgs.entries[0].status).toBe('dismissed')
    })

    it('cycles todos statuses: pending → in_progress → completed → pending', () => {
      renderModal({
        metadataKey: 'todos',
        entries: [{ id: '0', description: 'Task 1', status: 'pending' }],
      })
      const statusIcon = screen.getAllByTitle(/click to cycle/i)[0]!
      fireEvent.click(statusIcon)
      const callArgs = JSON.parse(mockedAuthFetch.mock.calls[0]![1]!.body as string)
      expect(callArgs.entries[0].status).toBe('in_progress')
    })

    it('cycles unknown key statuses generically', () => {
      renderModal({
        metadataKey: 'custom_section',
        entries: [{ id: '0', description: 'Custom', status: 'pending' }],
      })
      const statusIcon = screen.getAllByTitle(/click to cycle/i)[0]!
      fireEvent.click(statusIcon)
      expect(mockedAuthFetch).toHaveBeenCalled()
    })
  })

  // ── Criterion 4: Inline editing ─────────────────────────────────────
  describe('Criterion 4 — Inline description editing', () => {
    it('shows an input when clicking on an entry description', () => {
      renderModal()
      fireEvent.click(screen.getByText('First item'))
      expect(screen.getByDisplayValue('First item')).toBeInTheDocument()
    })

    it('saves the edited description on Enter and syncs to server', () => {
      renderModal()
      fireEvent.click(screen.getByText('First item'))
      const input = screen.getByDisplayValue('First item')
      fireEvent.change(input, { target: { value: 'Updated description' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(mockedAuthFetch).toHaveBeenCalledWith(
        '/api/sessions/session-1/metadata/review_findings',
        expect.objectContaining({ method: 'PUT' }),
      )
      const callArgs = JSON.parse(mockedAuthFetch.mock.calls[0]![1]!.body as string)
      expect(callArgs.entries[0].description).toBe('Updated description')
    })
  })

  // ── Criterion 5: Add entry ──────────────────────────────────────────
  describe('Criterion 5 — Add entry', () => {
    it('renders an input field at the bottom to add a new entry', () => {
      renderModal()
      expect(screen.getByPlaceholderText(/new/i)).toBeInTheDocument()
    })

    it('adds a new entry when submitting the add input and syncs to server', () => {
      renderModal({ entries: [] })
      const addInput = screen.getByPlaceholderText(/new/i)
      fireEvent.change(addInput, { target: { value: 'Newly added entry' } })
      fireEvent.keyDown(addInput, { key: 'Enter' })
      expect(mockedAuthFetch).toHaveBeenCalledWith(
        '/api/sessions/session-1/metadata/review_findings',
        expect.objectContaining({ method: 'PUT' }),
      )
    })
  })

  // ── Criterion 6: Delete entry ───────────────────────────────────────
  describe('Criterion 6 — Delete entry', () => {
    it('renders an X button on each entry line', () => {
      renderModal()
      const deleteButtons = screen.getAllByTitle(/delete/i)
      expect(deleteButtons.length).toBeGreaterThanOrEqual(2)
    })

    it('removes entry and syncs to server when clicking X', () => {
      renderModal({ entries: [{ id: '0', description: 'To delete', status: 'open' }] })
      const deleteBtn = screen.getByTitle(/delete/i)
      fireEvent.click(deleteBtn)
      expect(mockedAuthFetch).toHaveBeenCalledWith(
        '/api/sessions/session-1/metadata/review_findings',
        expect.objectContaining({ method: 'PUT' }),
      )
      const callArgs = JSON.parse(mockedAuthFetch.mock.calls[0]![1]!.body as string)
      expect(callArgs.entries.find((e: { id: string }) => e.id === '0')).toBeUndefined()
    })
  })

  // ── Criterion 7: Immediate save ─────────────────────────────────────
  describe('Criterion 7 — Immediate save via PUT', () => {
    it('calls PUT /api/sessions/:id/metadata/:key on status cycle', () => {
      renderModal()
      fireEvent.click(screen.getAllByTitle(/click to cycle/i)[0]!)
      expect(mockedAuthFetch).toHaveBeenCalledWith(
        '/api/sessions/session-1/metadata/review_findings',
        expect.objectContaining({ method: 'PUT' }),
      )
    })

    it('calls PUT /api/sessions/:id/metadata/:key on edit save', () => {
      renderModal()
      fireEvent.click(screen.getByText('First item'))
      fireEvent.keyDown(screen.getByDisplayValue('First item'), { key: 'Enter' })
      expect(mockedAuthFetch).toHaveBeenCalledWith(
        '/api/sessions/session-1/metadata/review_findings',
        expect.objectContaining({ method: 'PUT' }),
      )
    })

    it('calls PUT /api/sessions/:id/metadata/:key on add', () => {
      renderModal({ entries: [] })
      const input = screen.getByPlaceholderText(/new/i)
      fireEvent.change(input, { target: { value: 'New' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(mockedAuthFetch).toHaveBeenCalledWith(
        '/api/sessions/session-1/metadata/review_findings',
        expect.objectContaining({ method: 'PUT' }),
      )
    })

    it('calls PUT /api/sessions/:id/metadata/:key on delete', () => {
      renderModal()
      const deleteBtns = screen.getAllByTitle(/delete/i)
      fireEvent.click(deleteBtns[0]!)
      expect(mockedAuthFetch).toHaveBeenCalledWith(
        '/api/sessions/session-1/metadata/review_findings',
        expect.objectContaining({ method: 'PUT' }),
      )
    })
  })

  // ── Criterion 8: All types ──────────────────────────────────────────
  describe('Criterion 8 — All metadata types', () => {
    it('renders for criteria type', () => {
      renderModal({
        metadataKey: 'criteria',
        title: 'Acceptance Criteria',
        entries: [{ id: '0', description: 'Criterion 1', status: 'pending' }],
      })
      expect(screen.getByText('Criterion 1')).toBeInTheDocument()
    })

    it('renders for review_findings type', () => {
      renderModal({ metadataKey: 'review_findings', title: 'Review Findings' })
      expect(screen.getByText('First item')).toBeInTheDocument()
    })

    it('renders for todos type', () => {
      renderModal({
        metadataKey: 'todos',
        title: 'Tasks',
        entries: [{ id: '0', description: 'Task 1', status: 'pending' }],
      })
      expect(screen.getByText('Task 1')).toBeInTheDocument()
    })

    it('renders for unknown metadata keys', () => {
      renderModal({
        metadataKey: 'notes',
        title: 'Notes',
        entries: [{ id: '0', description: 'Note 1', status: 'active' }],
      })
      expect(screen.getByText('Note 1')).toBeInTheDocument()
    })
  })

  // ── Criterion 9: No server modification — reuses existing API ───────
  describe('Criterion 9 — Reuses existing API', () => {
    it('uses the same PUT /api/sessions/:id/metadata/:key endpoint as CriteriaEditor', () => {
      renderModal()
      fireEvent.click(screen.getAllByTitle(/click to cycle/i)[0]!)
      expect(mockedAuthFetch).toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/sessions\/[^/]+\/metadata\/[^/]+$/),
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    it('sends entries array in the body matching MetadataEntry shape', () => {
      renderModal()
      fireEvent.click(screen.getAllByTitle(/click to cycle/i)[0]!)
      const callArgs = JSON.parse(mockedAuthFetch.mock.calls[0]![1]!.body as string)
      expect(callArgs).toHaveProperty('entries')
      expect(Array.isArray(callArgs.entries)).toBe(true)
      callArgs.entries.forEach((entry: Record<string, unknown>) => {
        expect(entry).toHaveProperty('id')
        expect(entry).toHaveProperty('description')
        expect(entry).toHaveProperty('status')
      })
    })
  })
})
