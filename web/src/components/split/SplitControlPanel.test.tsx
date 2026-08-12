// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SplitControlPanel } from './SplitControlPanel'

const {
  focusPaneMock,
  closePaneMock,
  reorderPaneMock,
  openPaneMock,
  isPaneOpenMock,
  onLayoutChangeMock,
  createSessionMock,
  resetPendingSessionCreateMock,
  listProjectsMock,
} = vi.hoisted(() => ({
  focusPaneMock: vi.fn(),
  closePaneMock: vi.fn(),
  reorderPaneMock: vi.fn(),
  openPaneMock: vi.fn(async () => undefined),
  isPaneOpenMock: vi.fn((_id?: string) => false),
  onLayoutChangeMock: vi.fn(),
  createSessionMock: vi.fn(),
  resetPendingSessionCreateMock: vi.fn(),
  listProjectsMock: vi.fn(async () => undefined),
}))

let storeState: Record<string, unknown> = {}

vi.mock('../../stores/session', () => ({
  useSessionStore: Object.assign((selector: (state: unknown) => unknown) => selector(storeState), {
    getState: () => storeState,
  }),
}))

vi.mock('../../stores/project', () => ({
  useProjectStore: (selector: (state: unknown) => unknown) =>
    selector({
      projects: [
        { id: 'p1', name: 'acme-app', workdir: '/home/dev/acme-app' },
        { id: 'p2', name: 'other-repo', workdir: '/home/dev/other-repo' },
      ],
      listProjects: listProjectsMock,
    }),
}))

const pane = (id: string, title: string, messages: unknown[] = []) => ({
  session: { id, projectId: 'p1', metadata: { title } },
  messages,
})

const statsMessage = (generationSpeed: number, timestamp = Date.now()) => ({
  id: `m-${generationSpeed}`,
  role: 'assistant',
  content: 'test',
  timestamp: new Date(timestamp).toISOString(),
  tokenCount: 100,
  stats: {
    providerId: 'provider-1',
    providerName: 'Local vLLM',
    backend: 'vllm',
    model: 'test-model',
    mode: 'builder',
    totalTime: 10,
    toolTime: 2,
    prefillTokens: 60_000,
    prefillSpeed: 10_000,
    generationTokens: 60,
    generationSpeed,
  },
})

const makeSummary = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  projectId: 'p1',
  title: `Session ${id}`,
  workdir: `/tmp/${id}`,
  mode: 'builder',
  phase: 'idle',
  isRunning: false,
  isFavorite: false,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
  criteriaCount: 0,
  criteriaCompleted: 0,
  messageCount: 0,
  ...overrides,
})

describe('SplitControlPanel', () => {
  beforeEach(() => {
    storeState = {
      openSessionIds: [],
      focusedSessionId: null,
      panes: {},
      sessions: [],
      focusPane: focusPaneMock,
      closePane: closePaneMock,
      reorderPane: reorderPaneMock,
      openPane: openPaneMock,
      isPaneOpen: isPaneOpenMock,
      createSession: createSessionMock,
      resetPendingSessionCreate: resetPendingSessionCreateMock,
    }
    focusPaneMock.mockClear()
    closePaneMock.mockClear()
    reorderPaneMock.mockClear()
    openPaneMock.mockClear()
    isPaneOpenMock.mockReset()
    isPaneOpenMock.mockImplementation(() => false)
    onLayoutChangeMock.mockClear()
    createSessionMock.mockClear()
    resetPendingSessionCreateMock.mockClear()
    listProjectsMock.mockClear()
  })

  afterEach(() => cleanup())

  function renderPanel() {
    render(<SplitControlPanel layout="columns" onLayoutChange={onLayoutChangeMock} />)
  }

  it('lists open panes with reorder and close controls', () => {
    storeState.openSessionIds = ['s1', 's2']
    storeState.focusedSessionId = 's1'
    storeState.panes = { s1: pane('s1', 'First'), s2: pane('s2', 'Second') }
    renderPanel()

    const first = screen.getByText('First')
    expect(first).toBeDefined()
    expect(screen.getByText('Second')).toBeDefined()

    const rows = document.querySelectorAll('[data-open-pane]')
    expect(rows).toHaveLength(2)

    // Reorder the second pane up
    const secondRow = rows[1] as HTMLElement
    fireEvent.click(secondRow.querySelector('[aria-label="Move pane left"]')!)
    expect(reorderPaneMock).toHaveBeenCalledWith('s2', -1)

    // Close the first pane
    const firstRow = rows[0] as HTMLElement
    fireEvent.click(firstRow.querySelector('[aria-label="Close pane"]')!)
    expect(closePaneMock).toHaveBeenCalledWith('s1')
  })

  it('orders sessions running-first then by recency', () => {
    storeState.openSessionIds = []
    storeState.panes = {}
    storeState.sessions = [
      makeSummary('old-idle', { updatedAt: '2024-01-02', isRunning: false }),
      makeSummary('new-running', { updatedAt: '2024-01-01', isRunning: true }),
      makeSummary('new-idle', { updatedAt: '2024-01-03', isRunning: false }),
    ]
    renderPanel()

    const items = [...document.querySelectorAll('[data-session-item]')].map((el) =>
      el.getAttribute('data-session-item'),
    )
    expect(items).toEqual(['new-running', 'new-idle', 'old-idle'])
  })

  it('opens a closed session as a pane and focuses an open one', () => {
    storeState.openSessionIds = ['s1']
    storeState.focusedSessionId = 's1'
    storeState.panes = { s1: pane('s1', 'First') }
    storeState.sessions = [makeSummary('s1'), makeSummary('s2')]
    isPaneOpenMock.mockImplementation((id?: string) => id === 's1')

    renderPanel()

    const items = document.querySelectorAll('[data-session-item]')
    // s2 is closed → openPane
    fireEvent.click(items[1] as HTMLElement)
    expect(openPaneMock).toHaveBeenCalledWith('s2', { focus: true })

    // s1 is already open → focus
    fireEvent.click(items[0] as HTMLElement)
    expect(focusPaneMock).toHaveBeenCalledWith('s1')
  })

  it('switches the pane layout via the segmented control', () => {
    storeState.openSessionIds = ['s1']
    storeState.panes = { s1: pane('s1', 'One') }
    renderPanel()
    fireEvent.click(screen.getByLabelText('Grid layout'))
    expect(onLayoutChangeMock).toHaveBeenCalledWith('grid')
    fireEvent.click(screen.getByLabelText('Columns layout'))
    expect(onLayoutChangeMock).toHaveBeenCalledWith('columns')
  })

  it('collapses to zero width when hidden', () => {
    storeState.openSessionIds = ['s1']
    storeState.panes = { s1: pane('s1', 'One') }
    render(<SplitControlPanel layout="columns" onLayoutChange={onLayoutChangeMock} collapsed />)
    const aside = document.querySelector('aside')
    expect(aside?.className).toContain('w-0')
    expect(aside?.className).toContain('overflow-hidden')
  })

  it('shows the aggregate generation chart between open panes and sessions', () => {
    storeState.openSessionIds = ['s1', 's2']
    storeState.focusedSessionId = 's1'
    storeState.panes = {
      s1: pane('s1', 'First', [statsMessage(30, Date.now() - 60_000)]),
      s2: pane('s2', 'Second', [statsMessage(40, Date.now() - 120_000)]),
    }
    renderPanel()
    const section = screen.getByTestId('aggregate-stats')
    expect(section.querySelector('svg')).not.toBeNull()
    expect(screen.getByText('70 tok/s')).toBeDefined()
  })

  it('shows a placeholder when no open pane has stats', () => {
    storeState.openSessionIds = ['s1']
    storeState.panes = { s1: pane('s1', 'First') }
    renderPanel()
    const section = screen.getByTestId('aggregate-stats')
    expect(section).toBeDefined()
    expect(screen.getByText('No generation in the last 30 min')).toBeDefined()
    expect(section.querySelector('svg')).toBeNull()
  })

  it('opens the project picker from the plus button and refreshes projects', () => {
    renderPanel()
    fireEvent.click(screen.getByLabelText('New session'))
    expect(listProjectsMock).toHaveBeenCalled()
    expect(screen.getByText('acme-app')).toBeDefined()
    expect(screen.getByText('other-repo')).toBeDefined()
  })

  it('creates a session in the chosen project and opens it as a focused pane', async () => {
    createSessionMock.mockResolvedValue({ id: 's9', projectId: 'p2' })
    renderPanel()
    fireEvent.click(screen.getByLabelText('New session'))
    fireEvent.click(screen.getByText('other-repo'))

    await waitFor(() => expect(createSessionMock).toHaveBeenCalledWith('p2'))
    await waitFor(() => expect(openPaneMock).toHaveBeenCalledWith('s9', { focus: true }))
    expect(resetPendingSessionCreateMock).toHaveBeenCalled()
  })

  it('keeps the picker open with an inline error when session creation fails', async () => {
    createSessionMock.mockResolvedValue(null)
    renderPanel()
    fireEvent.click(screen.getByLabelText('New session'))
    fireEvent.click(screen.getByText('other-repo'))

    await waitFor(() => expect(createSessionMock).toHaveBeenCalledWith('p2'))
    expect(openPaneMock).not.toHaveBeenCalled()
    expect(resetPendingSessionCreateMock).not.toHaveBeenCalled()
    // The picker stays open and surfaces the failure instead of silently closing
    expect(screen.getByText(/could not create/i)).toBeDefined()
    expect(screen.getByText('other-repo')).toBeDefined()
  })
})
