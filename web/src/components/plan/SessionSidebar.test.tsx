// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Mock } from 'vitest'
import { SessionSidebar } from './SessionSidebar'
import { SessionScopeProvider } from '../../stores/session/session-scope'
import type { Message } from '@shared/types.js'

/* ------------------------------------------------------------------ */
/*  Store mocks — shared across all tests                             */
/* ------------------------------------------------------------------ */

const mockSessionStore = vi.fn() as Mock
const mockConfigStore = vi.fn() as Mock
const mockUpdateStore = vi.fn() as Mock

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector?: (s: unknown) => unknown) =>
    selector ? selector(mockSessionStore()) : mockSessionStore(),
}))

const mockSettings: Record<string, string> = {}

vi.mock('../../hooks/useSetting', () => ({
  useSetting: (key: string, fallback = '') => ({ value: mockSettings[key] ?? fallback, loading: false }),
}))

vi.mock('../../stores/config', () => ({
  useConfigStore: (selector?: (s: unknown) => unknown) => (selector ? selector(mockConfigStore()) : mockConfigStore()),
}))

vi.mock('../../stores/update', () => ({
  useUpdateStore: (selector?: (s: unknown) => unknown) => (selector ? selector(mockUpdateStore()) : mockUpdateStore()),
}))

const mockUseGitStatus = vi.fn() as Mock

vi.mock('../../hooks/useGitStatus', () => ({
  useGitStatus: (...args: unknown[]) => mockUseGitStatus(...args),
}))

vi.mock('../../hooks/useSessionStats', () => ({
  useSessionStats: vi.fn(() => null),
}))

/* ------------------------------------------------------------------ */
/*  Child component mocks                                             */
/* ------------------------------------------------------------------ */

vi.mock('./StatsModal', () => ({ StatsModal: () => null }))
vi.mock('./CriteriaEditor', () => ({ CriteriaEditor: () => null }))
vi.mock('../shared/MetadataEntries', () => ({
  MetadataEntries: () => null,
  MetadataSectionHeader: ({ title: _title }: { title: string }) => null,
}))
vi.mock('../shared/MetadataModal', () => ({ MetadataModal: () => null }))
vi.mock('./DevServerFooter', () => ({ DevServerFooter: () => null }))
vi.mock('./BackgroundProcesses', () => ({ BackgroundProcesses: () => null }))
vi.mock('../shared/icons', () => ({
  FolderIcon: () => null,
  BranchIcon: () => null,
  ReloadIcon: () => null,
}))
vi.mock('../AutoUpdateModal', () => ({ AutoUpdateModal: () => null }))
vi.mock('./DiffViewer', () => ({ DiffViewer: () => null }))
vi.mock('./BranchModal', () => ({ BranchModal: () => null }))
vi.mock('./WorkspaceModal', () => ({ WorkspaceModal: () => null }))

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  vi.clearAllMocks()
  Object.keys(mockSettings).forEach((k) => delete mockSettings[k])

  mockSessionStore.mockReturnValue({
    currentSession: { id: 's1', projectId: 'p1', metadataEntries: {}, workdir: '/tmp/project' },
  })

  mockConfigStore.mockReturnValue({ version: '1.0.0' })
  mockUpdateStore.mockReturnValue({ status: 'idle', check: vi.fn() })
})

describe('SessionSidebar — git repo guards', () => {
  it('[AUTOMATED] shows workspace and branch Edit buttons when project is a git repository', () => {
    mockUseGitStatus.mockReturnValue({ branch: 'main', diff: { files: [], loading: false, error: null } })

    const html = renderToStaticMarkup(<SessionSidebar messages={[]} />)

    expect(html).toContain('Edit')
    const editCount = (html.match(/Edit/g) ?? []).length
    expect(editCount).toBe(2)
  })

  it('[AUTOMATED] hides Edit buttons when project is not a git repository', () => {
    mockUseGitStatus.mockReturnValue({ branch: null, diff: { files: [], loading: false, error: null } })

    const html = renderToStaticMarkup(<SessionSidebar messages={[]} />)

    expect(html).not.toContain('Edit')
  })

  it('shows only the basename for a Windows workspace path', () => {
    mockUseGitStatus.mockReturnValue({ branch: 'main', diff: { files: [], loading: false, error: null } })
    mockSessionStore.mockReturnValue({
      currentSession: {
        id: 's1',
        projectId: 'p1',
        metadataEntries: {},
        workspace: 'C:\\Users\\me\\projects\\my-app',
        workdir: 'C:\\Users\\me\\projects\\my-app',
      },
    })

    const html = renderToStaticMarkup(<SessionSidebar messages={[]} />)

    expect(html).toContain('my-app')
    expect(html).not.toContain('C:\\Users\\me\\projects\\my-app')
  })
})

describe('SessionSidebar — split view pane isolation', () => {
  it('renders the scoped pane workspace, not the focused session', () => {
    mockUseGitStatus.mockReturnValue({ branch: 'feature-a', diff: { files: [], loading: false, error: null } })
    mockSessionStore.mockReturnValue({
      focusedSessionId: 'B',
      currentSession: {
        id: 'B',
        projectId: 'p1',
        metadataEntries: {},
        workspace: '/repo/workspace-b',
        workdir: '/repo',
      },
      panes: {
        A: {
          session: {
            id: 'A',
            projectId: 'p1',
            metadataEntries: {},
            workspace: '/repo/workspace-a',
            workdir: '/repo',
          },
        },
        B: {
          session: {
            id: 'B',
            projectId: 'p1',
            metadataEntries: {},
            workspace: '/repo/workspace-b',
            workdir: '/repo',
          },
        },
      },
    })

    const html = renderToStaticMarkup(
      <SessionScopeProvider value="A">
        <SessionSidebar messages={[]} />
      </SessionScopeProvider>,
    )

    expect(html).toContain('workspace-a')
    expect(html).not.toContain('workspace-b')
  })
})

describe('SessionSidebar — live turn stats', () => {
  it('merges live cumulative stats into the aggregate while a turn is running', () => {
    mockUseGitStatus.mockReturnValue({ branch: null, diff: { files: [], loading: false, error: null } })
    mockSessionStore.mockReturnValue({
      currentSession: { id: 's1', projectId: 'p1', metadataEntries: {}, workdir: '/tmp/project' },
      panes: {
        s1: {
          session: { id: 's1', projectId: 'p1', metadataEntries: {}, workdir: '/tmp/project' },
          liveTurnStats: {
            providerId: 'p',
            providerName: 'P',
            backend: 'ollama',
            model: 'm',
            mode: 'builder',
            totalTime: 12,
            toolTime: 2,
            prefillTokens: 60000,
            prefillSpeed: 20000,
            generationTokens: 600,
            generationSpeed: 150,
          },
        },
      },
    })

    // One already-finished response (aiTime 7) plus the live turn (aiTime 10)
    // → merged aiTime 17s, shown live while the turn is running.
    const previousMessage: Message = {
      id: 'prev',
      role: 'assistant',
      content: 'done',
      timestamp: '2024-01-01T10:00:00Z',
      stats: {
        providerId: 'p',
        providerName: 'P',
        backend: 'ollama',
        model: 'm',
        mode: 'planner',
        totalTime: 8,
        toolTime: 1,
        prefillTokens: 40000,
        prefillSpeed: 10000,
        generationTokens: 400,
        generationSpeed: 100,
      },
    }

    const html = renderToStaticMarkup(
      <SessionScopeProvider value="s1">
        <SessionSidebar messages={[previousMessage]} />
      </SessionScopeProvider>,
    )

    expect(html).toContain('17s')
    // Weighted averages across both responses: prefill 100k/7s ≈ 14.3k, gen 1000/8s = 125
    expect(html).toContain('14.3k')
    expect(html).toContain('125.0')
  })
})

describe('SessionSidebar — savings segments', () => {
  it('shows session RTK and Headroom savings next to the pp/tg stats', () => {
    mockUseGitStatus.mockReturnValue({ branch: null, diff: { files: [], loading: false, error: null } })
    mockSessionStore.mockReturnValue({
      currentSession: { id: 's1', projectId: 'p1', metadataEntries: {}, workdir: '/tmp/project' },
      panes: {
        s1: {
          session: { id: 's1', projectId: 'p1', metadataEntries: {}, workdir: '/tmp/project' },
          liveTurnStats: {
            providerId: 'p',
            providerName: 'P',
            backend: 'ollama',
            model: 'm',
            mode: 'builder',
            totalTime: 10,
            toolTime: 0,
            prefillTokens: 1000,
            prefillSpeed: 100,
            generationTokens: 100,
            generationSpeed: 10,
            rtkTokensSaved: 12345,
            headroomTokensSaved: 678,
          },
        },
      },
    })

    mockSettings['tools.useRtk'] = 'true'
    mockSettings['tools.useHeadroom'] = 'true'

    const html = renderToStaticMarkup(
      <SessionScopeProvider value="s1">
        <SessionSidebar messages={[]} />
      </SessionScopeProvider>,
    )

    expect(html).toContain('>rtk</span>')
    expect(html).toContain('>hr</span>')
    expect(html).toContain('>gt</span>')
    expect(html).toContain('−12 345')
    expect(html).toContain('−678')
  })

  it('hides the savings segments when nothing was saved', () => {
    mockUseGitStatus.mockReturnValue({ branch: null, diff: { files: [], loading: false, error: null } })
    mockSessionStore.mockReturnValue({
      currentSession: { id: 's1', projectId: 'p1', metadataEntries: {}, workdir: '/tmp/project' },
      panes: {
        s1: {
          session: { id: 's1', projectId: 'p1', metadataEntries: {}, workdir: '/tmp/project' },
          liveTurnStats: {
            providerId: 'p',
            providerName: 'P',
            backend: 'ollama',
            model: 'm',
            mode: 'builder',
            totalTime: 10,
            toolTime: 0,
            prefillTokens: 1000,
            prefillSpeed: 100,
            generationTokens: 100,
            generationSpeed: 10,
          },
        },
      },
    })

    const html = renderToStaticMarkup(
      <SessionScopeProvider value="s1">
        <SessionSidebar messages={[]} />
      </SessionScopeProvider>,
    )

    expect(html).not.toContain('>rtk</span>')
    expect(html).not.toContain('>hr</span>')
  })

  it('hides savings when the tools are disabled in settings', () => {
    mockUseGitStatus.mockReturnValue({ branch: null, diff: { files: [], loading: false, error: null } })
    mockSessionStore.mockReturnValue({
      currentSession: { id: 's1', projectId: 'p1', metadataEntries: {}, workdir: '/tmp/project' },
      panes: {
        s1: {
          session: { id: 's1', projectId: 'p1', metadataEntries: {}, workdir: '/tmp/project' },
          liveTurnStats: {
            providerId: 'p',
            providerName: 'P',
            backend: 'ollama',
            model: 'm',
            mode: 'builder',
            totalTime: 10,
            toolTime: 0,
            prefillTokens: 1000,
            prefillSpeed: 100,
            generationTokens: 100,
            generationSpeed: 10,
            rtkTokensSaved: 12345,
            headroomTokensSaved: 678,
          },
        },
      },
    })

    const html = renderToStaticMarkup(
      <SessionScopeProvider value="s1">
        <SessionSidebar messages={[]} />
      </SessionScopeProvider>,
    )

    expect(html).not.toContain('>rtk</span>')
    expect(html).not.toContain('>hr</span>')
    expect(html).toContain('>gt</span>')
  })
})
