// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock focusChatTextarea — harmless in test env but we avoid any side effects
// ---------------------------------------------------------------------------
vi.mock('../../lib/focusChatTextarea', () => ({
  focusChatTextarea: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Shared mock helpers — referenced by vi.mock factories below
// ---------------------------------------------------------------------------
const mockCreateSession = vi.fn()
const mockKillSession = vi.fn()
const mockSetWorkdir = vi.fn()
const mockFetchSessions = vi.fn().mockResolvedValue(undefined)
const mockSessions: unknown[] = []

const useTerminalStoreMock = vi.fn()
const useProjectStoreMock = vi.fn()
const useSessionStoreMock = vi.fn()

// ---------------------------------------------------------------------------
// Store mocks — hoisted before imports via vi.mock
// ---------------------------------------------------------------------------
vi.mock('../../stores/terminal', () => ({
  useTerminalStore: (selector: (s: unknown) => unknown) => useTerminalStoreMock(selector),
}))

vi.mock('../../stores/project', () => ({
  useProjectStore: (selector: (s: unknown) => unknown) => useProjectStoreMock(selector),
}))

vi.mock('../../stores/session/store', () => ({
  useSessionStore: (selector: (s: unknown) => unknown) => useSessionStoreMock(selector),
}))

// ---------------------------------------------------------------------------
// Import after mocks are in place
// ---------------------------------------------------------------------------
import { TerminalDrawer } from './TerminalDrawer'

describe('TerminalDrawer workspace integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  afterEach(cleanup)

  // -----------------------------------------------------------------------
  // Helper: default store state (no session, no project)
  // -----------------------------------------------------------------------
  function setupDefaultMocks() {
    useTerminalStoreMock.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        createSession: mockCreateSession,
        killSession: mockKillSession,
        sessions: mockSessions,
        setWorkdir: mockSetWorkdir,
        fetchSessions: mockFetchSessions,
      }),
    )

    useProjectStoreMock.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        currentProject: null,
      }),
    )

    useSessionStoreMock.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        currentSession: null,
      }),
    )
  }

  // -----------------------------------------------------------------------
  // Criterion 0+1+2: Import useSessionStore, read currentSession, and
  // use currentSession?.workspace as workdir when available
  // -----------------------------------------------------------------------
  it('should use currentSession.workspace as workdir when workspace is set', () => {
    useSessionStoreMock.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        currentSession: { id: 's1', projectId: 'p1', workspace: '/workspace/path' },
      }),
    )

    useProjectStoreMock.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        currentProject: { id: 'p1', workdir: '/project/workdir' },
      }),
    )

    render(<TerminalDrawer isOpen={true} onClose={vi.fn()} />)

    expect(mockSetWorkdir).toHaveBeenCalledWith('/workspace/path')
    expect(mockSetWorkdir).toHaveBeenCalledTimes(1)
  })

  // -----------------------------------------------------------------------
  // Criterion 2: Fall back to currentProject.workdir when workspace absent
  // -----------------------------------------------------------------------
  it('should fall back to currentProject.workdir when currentSession.workspace is undefined', () => {
    useSessionStoreMock.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        currentSession: { id: 's1', projectId: 'p1' },
      }),
    )

    useProjectStoreMock.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        currentProject: { id: 'p1', workdir: '/project/workdir' },
      }),
    )

    render(<TerminalDrawer isOpen={true} onClose={vi.fn()} />)

    expect(mockSetWorkdir).toHaveBeenCalledWith('/project/workdir')
    expect(mockSetWorkdir).toHaveBeenCalledTimes(1)
  })

  // -----------------------------------------------------------------------
  // Criterion 2: Neither workspace nor project workdir — no setWorkdir call
  // -----------------------------------------------------------------------
  it('should not call setWorkdir when both workspace and project workdir are missing', () => {
    render(<TerminalDrawer isOpen={true} onClose={vi.fn()} />)

    expect(mockSetWorkdir).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // Criterion 3: The "New terminal" button uses the workspace path as cwd
  // The button passes undefined as workdir, so createSession falls back to
  // the store's workdir (which was set by the effect to workspace).
  // -----------------------------------------------------------------------
  it('should call createSession with undefined workdir when new terminal button is clicked', () => {
    useSessionStoreMock.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        currentSession: { id: 's1', projectId: 'p1', workspace: '/workspace/path' },
      }),
    )

    useProjectStoreMock.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        currentProject: { id: 'p1', workdir: '/project/workdir' },
      }),
    )

    render(<TerminalDrawer isOpen={true} onClose={vi.fn()} />)

    // The effect should have set workdir to the workspace path
    expect(mockSetWorkdir).toHaveBeenCalledWith('/workspace/path')

    // Find the "New terminal" button by title and click it
    const buttons = document.querySelectorAll('button')
    const newTerminalBtn = Array.from(buttons).find((b) => b.getAttribute('title') === 'New terminal')
    expect(newTerminalBtn).not.toBeNull()

    newTerminalBtn!.click()

    expect(mockCreateSession).toHaveBeenCalledWith(undefined, 'p1')
    expect(mockCreateSession).toHaveBeenCalledTimes(1)
  })
})
