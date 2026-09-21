// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SplitNewSessionModal } from './SplitNewSessionModal'

const { createSessionMock, openPaneMock, resetPendingSessionCreateMock } = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  openPaneMock: vi.fn(async () => undefined),
  resetPendingSessionCreateMock: vi.fn(),
}))

let projects: Array<Record<string, unknown>>

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      createSession: createSessionMock,
      openPane: openPaneMock,
      resetPendingSessionCreate: resetPendingSessionCreateMock,
    }),
}))

vi.mock('../../hooks/useProjects', () => ({
  useProjects: () => ({ projects, refresh: vi.fn(), loading: false }),
}))

interface ProjectFixture {
  id: string
  name: string
  workdir?: string
  isStarred?: boolean
}

const makeProject = ({ id, name, workdir = `/home/dev/${id}`, isStarred = false }: ProjectFixture) => ({
  id,
  name,
  workdir,
  isStarred,
})

beforeEach(() => {
  vi.clearAllMocks()
  projects = []
  Element.prototype.scrollIntoView = vi.fn()
})

const renderModal = () => render(<SplitNewSessionModal isOpen onClose={() => {}} />)

const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-project-row]'))

const rowNames = () => rows().map((el) => el.textContent ?? '')

describe('SplitNewSessionModal', () => {
  it('lists starred projects first, each group ordered a-z', () => {
    projects = [
      makeProject({ id: 'z', name: 'Zebra App' }),
      makeProject({ id: 'a', name: 'Alpha Repo', isStarred: true }),
      makeProject({ id: 'b', name: 'beta-tools', isStarred: true }),
      makeProject({ id: 'g', name: 'Gamma' }),
    ]
    renderModal()
    expect(rowNames()).toEqual([
      expect.stringContaining('Alpha Repo'),
      expect.stringContaining('beta-tools'),
      expect.stringContaining('Gamma'),
      expect.stringContaining('Zebra App'),
    ])
  })

  it('marks starred rows with a star icon and leaves others as folders', () => {
    projects = [makeProject({ id: 'a', name: 'Alpha Repo', isStarred: true }), makeProject({ id: 'b', name: 'Beta' })]
    renderModal()
    const [starredRow, plainRow] = rows()
    expect(starredRow!.hasAttribute('data-starred')).toBe(true)
    expect(plainRow!.hasAttribute('data-starred')).toBe(false)
  })

  it('filters projects by name, case-insensitively, as you type', () => {
    projects = [
      makeProject({ id: 'z', name: 'Zebra App' }),
      makeProject({ id: 'b', name: 'beta-tools' }),
      makeProject({ id: 'g', name: 'Gamma' }),
    ]
    renderModal()
    const input = screen.getByPlaceholderText('Search projects…')
    fireEvent.change(input, { target: { value: 'BE' } })
    expect(rowNames()).toEqual([expect.stringContaining('beta-tools')])
  })

  it('shows a muted no-match message when nothing matches', () => {
    projects = [makeProject({ id: 'g', name: 'Gamma' })]
    renderModal()
    const input = screen.getByPlaceholderText('Search projects…')
    fireEvent.change(input, { target: { value: 'zzz' } })
    expect(screen.getByText('No projects match')).toBeDefined()
    expect(rows()).toHaveLength(0)
  })

  it('auto-focuses the search input when the modal opens', () => {
    projects = [makeProject({ id: 'g', name: 'Gamma' })]
    renderModal()
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Search projects…'))
  })

  it('selects the highlighted project on Enter after navigating with arrows', async () => {
    createSessionMock.mockResolvedValue({ id: 's1', projectId: 'b' })
    projects = [makeProject({ id: 'a', name: 'Alpha Repo' }), makeProject({ id: 'b', name: 'Beta Repo' })]
    renderModal()
    const input = screen.getByPlaceholderText('Search projects…')
    fireEvent.change(input, { target: { value: 'repo' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(createSessionMock).toHaveBeenCalledWith('b'))
    await waitFor(() => expect(openPaneMock).toHaveBeenCalledWith('s1', { focus: true }))
    expect(resetPendingSessionCreateMock).toHaveBeenCalled()
  })

  it('does nothing on Enter when there are no matches', () => {
    projects = [makeProject({ id: 'g', name: 'Gamma' })]
    renderModal()
    const input = screen.getByPlaceholderText('Search projects…')
    fireEvent.change(input, { target: { value: 'zzz' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(createSessionMock).not.toHaveBeenCalled()
  })

  it('clears the query on a first Escape and closes on a second one', () => {
    const onClose = vi.fn()
    projects = [makeProject({ id: 'g', name: 'Gamma' })]
    render(<SplitNewSessionModal isOpen onClose={onClose} />)
    const input = screen.getByPlaceholderText('Search projects…')
    fireEvent.change(input, { target: { value: 'gamma' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect((input as HTMLInputElement).value).toBe('')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('moves the highlight with hover so Enter follows the pointer', async () => {
    createSessionMock.mockResolvedValue({ id: 's1', projectId: 'b' })
    projects = [makeProject({ id: 'a', name: 'Alpha Repo' }), makeProject({ id: 'b', name: 'Beta Repo' })]
    renderModal()
    const input = screen.getByPlaceholderText('Search projects…')
    fireEvent.mouseEnter(rows()[1]!)
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(createSessionMock).toHaveBeenCalledWith('b'))
  })

  it('selects the project on a plain click', async () => {
    createSessionMock.mockResolvedValue({ id: 's1', projectId: 'g' })
    projects = [makeProject({ id: 'g', name: 'Gamma' })]
    renderModal()
    fireEvent.click(screen.getByText('Gamma'))

    await waitFor(() => expect(createSessionMock).toHaveBeenCalledWith('g'))
  })

  it('shows the empty state when there are no projects', () => {
    projects = []
    renderModal()
    expect(screen.getByText(/No projects yet/)).toBeDefined()
  })

  it('shows the keyboard hint in the footer when there are projects and hides it otherwise', () => {
    projects = [makeProject({ id: 'g', name: 'Gamma' })]
    const { unmount } = renderModal()
    expect(screen.getByText('↑ ↓ to navigate · Enter to select')).toBeDefined()
    unmount()

    projects = []
    renderModal()
    expect(screen.queryByText('↑ ↓ to navigate · Enter to select')).toBeNull()
  })
})
