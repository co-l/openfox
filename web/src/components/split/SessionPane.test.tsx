// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SessionPane } from './SessionPane'

const { authFetchMock, tasksModalProps, settingsModalProps } = vi.hoisted(() => ({
  authFetchMock: vi.fn(async () => ({ ok: true })),
  tasksModalProps: { isOpen: false, projectId: '' },
  settingsModalProps: { isOpen: false },
}))

let storeState: Record<string, unknown> = {}

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) => selector(storeState),
}))

vi.mock('../../hooks/useProjects', () => ({
  useProjects: () => ({
    projects: [{ id: 'p1', name: 'acme-app' }],
    refresh: vi.fn(),
    loading: false,
  }),
}))

vi.mock('../../lib/api', () => ({ authFetch: authFetchMock }))

vi.mock('wouter', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
}))

vi.mock('../tasks/TasksModal', () => ({
  TasksModal: (props: { isOpen: boolean; projectId: string }) => {
    tasksModalProps.isOpen = props.isOpen
    tasksModalProps.projectId = props.projectId
    return <div data-testid="tasks-modal" />
  },
}))

vi.mock('../settings/ProjectSettingsModal', () => ({
  ProjectSettingsModal: (props: { isOpen: boolean }) => {
    settingsModalProps.isOpen = props.isOpen
    return <div data-testid="settings-modal" />
  },
}))

const planPanelProps = { sessionId: '', criteriaSidebarOpen: true }
vi.mock('../plan/PlanPanel', () => ({
  PlanPanel: (props: { sessionId: string; criteriaSidebarOpen: boolean }) => {
    planPanelProps.sessionId = props.sessionId
    planPanelProps.criteriaSidebarOpen = props.criteriaSidebarOpen
    return <div data-testid="plan-panel" />
  },
}))

function makePane(id: string, overrides: Record<string, unknown> = {}) {
  return {
    session: { id, projectId: 'p1', metadata: { title: 'Auth refactor' }, isRunning: true, phase: 'build' },
    messages: [],
    hiddenCount: 0,
    currentTodos: [],
    pendingPathConfirmations: [],
    pendingQuestions: [],
    ...overrides,
  }
}

const props = {
  sessionId: 's1',
  focused: false,
  onFocus: vi.fn(),
  onClose: vi.fn(),
}

describe('SessionPane', () => {
  beforeEach(() => {
    storeState = { panes: { s1: makePane('s1') } }
    planPanelProps.sessionId = ''
    planPanelProps.criteriaSidebarOpen = false
    tasksModalProps.isOpen = false
    tasksModalProps.projectId = ''
    settingsModalProps.isOpen = false
    authFetchMock.mockClear()
    props.onFocus.mockClear()
    props.onClose.mockClear()
  })

  afterEach(() => cleanup())

  it('renders project tag, title and the full feed panel', () => {
    render(<SessionPane {...props} />)
    expect(screen.getByText('acme-app')).toBeDefined()
    expect(screen.getByText('Auth refactor')).toBeDefined()
    expect(screen.getByTestId('plan-panel')).toBeDefined()
    // Legacy phase labels are not part of the pane header
    expect(screen.queryByText('Build')).toBeNull()
  })

  it('links the session title to the session page', () => {
    render(<SessionPane {...props} />)
    const link = screen.getByRole('link', { name: 'Auth refactor' })
    expect(link.getAttribute('href')).toBe('/p/p1/s/s1')
  })

  it('keeps a plain title span when the pane project is unknown', () => {
    storeState.panes = {
      s1: makePane('s1', { session: { id: 's1', metadata: { title: 'Orphan' } } }),
    }
    render(<SessionPane {...props} />)
    const title = screen.getByText('Orphan')
    expect(title.tagName).toBe('SPAN')
    expect(screen.queryByRole('link', { name: 'Orphan' })).toBeNull()
  })

  it('merges extra classes onto the pane root (flex sizing in columns mode)', () => {
    render(<SessionPane {...props} className="flex-1" />)
    const root = document.querySelector('[data-split-pane="s1"]')
    expect(root?.className).toContain('flex-1')
  })

  it('renders attention badges for pending confirmations and questions', () => {
    storeState.panes = {
      s1: makePane('s1', { pendingPathConfirmations: [{ callId: 'c1' }], pendingQuestions: [{ callId: 'q1' }] }),
    }
    render(<SessionPane {...props} />)
    expect(screen.getByTitle('1 question · 1 confirmation')).toBeDefined()
  })

  it('mounts the pane root as a container so breakpoints apply per pane', () => {
    render(<SessionPane {...props} />)
    const root = document.querySelector('[data-split-pane="s1"]')
    expect(root?.className).toContain('@container')
  })

  it('feeds the scoped session and criteria state into the PlanPanel', () => {
    render(<SessionPane {...props} />)
    expect(planPanelProps.sessionId).toBe('s1')
    // Narrow panes (0px in jsdom) start with the criteria sidebar closed
    expect(planPanelProps.criteriaSidebarOpen).toBe(false)
  })

  it('toggles the per-pane criteria sidebar independently', () => {
    render(<SessionPane {...props} />)
    fireEvent.click(screen.getByLabelText('Show criteria sidebar'))
    expect(planPanelProps.criteriaSidebarOpen).toBe(true)
    fireEvent.click(screen.getByLabelText('Hide criteria sidebar'))
    expect(planPanelProps.criteriaSidebarOpen).toBe(false)
  })

  it('fires close and focus actions', () => {
    render(<SessionPane {...props} />)
    fireEvent.click(screen.getByLabelText('Close pane'))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('marks the pane as focused', () => {
    render(<SessionPane {...props} focused={true} />)
    expect(document.querySelector('[data-focused="true"]')).not.toBeNull()
  })

  it('turns the project tag into a dropdown with project actions', () => {
    render(<SessionPane {...props} />)
    fireEvent.click(screen.getByTitle('acme-app'))
    expect(screen.getByText('Manage tasks')).toBeDefined()
    expect(screen.getByText('Open project folder')).toBeDefined()
    expect(screen.getByText('Edit project settings')).toBeDefined()
  })

  it('opens the tasks modal scoped to the pane project from the dropdown', () => {
    render(<SessionPane {...props} />)
    fireEvent.click(screen.getByTitle('acme-app'))
    fireEvent.click(screen.getByText('Manage tasks'))
    expect(tasksModalProps.isOpen).toBe(true)
    expect(tasksModalProps.projectId).toBe('p1')
  })

  it('fires the open-folder endpoint for the pane project from the dropdown', () => {
    render(<SessionPane {...props} />)
    fireEvent.click(screen.getByTitle('acme-app'))
    fireEvent.click(screen.getByText('Open project folder'))
    expect(authFetchMock).toHaveBeenCalledWith('/api/projects/p1/open-folder')
  })

  it('opens the project settings modal for the pane project from the dropdown', () => {
    render(<SessionPane {...props} />)
    fireEvent.click(screen.getByTitle('acme-app'))
    fireEvent.click(screen.getByText('Edit project settings'))
    expect(settingsModalProps.isOpen).toBe(true)
  })

  it('falls back to a plain project-id tag when the project record is unknown', () => {
    storeState.panes = {
      s1: makePane('s1', { session: { id: 's1', projectId: 'ghost-project', metadata: { title: 'Ghost' } } }),
    }
    render(<SessionPane {...props} />)
    expect(screen.getByText('ghost-proj')).toBeDefined()
    expect(screen.queryByTitle('ghost-proj')).toBeNull()
    expect(screen.queryByText('Manage tasks')).toBeNull()
  })
})
