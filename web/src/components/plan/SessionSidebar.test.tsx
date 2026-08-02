// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Mock } from 'vitest'
import { SessionSidebar } from './SessionSidebar'

/* ------------------------------------------------------------------ */
/*  Store mocks — shared across all tests                             */
/* ------------------------------------------------------------------ */

const mockSessionStore = vi.fn() as Mock
const mockSettingsStore = vi.fn() as Mock
const mockConfigStore = vi.fn() as Mock
const mockUpdateStore = vi.fn() as Mock

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector?: (s: unknown) => unknown) =>
    selector ? selector(mockSessionStore()) : mockSessionStore(),
}))

vi.mock('../../stores/settings', () => ({
  useSettingsStore: (selector?: (s: unknown) => unknown) =>
    selector ? selector(mockSettingsStore()) : mockSettingsStore(),
  SETTINGS_KEYS: { DISPLAY_SHOW_OPEN_IN_EDITOR: 'display.showOpenInEditor' },
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

vi.mock('./StatsModal', () => ({ default: () => null }))
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

  mockSessionStore.mockReturnValue({
    currentSession: { id: 's1', projectId: 'p1', metadataEntries: {}, workdir: '/tmp/project' },
  })

  mockSettingsStore.mockReturnValue({ settings: {} })
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
