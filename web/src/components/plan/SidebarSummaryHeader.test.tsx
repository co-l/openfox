// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import type { Mock } from 'vitest'
import { SidebarSummaryHeader } from './SidebarSummaryHeader'

/* ------------------------------------------------------------------ */
/*  Store mocks                                                       */
/* ------------------------------------------------------------------ */

const mockSessionStore = vi.fn() as Mock
const mockDevServerStore = vi.fn() as Mock
const mockUseGitStatus = vi.fn() as Mock

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector?: (s: unknown) => unknown) =>
    selector ? selector(mockSessionStore()) : mockSessionStore(),
}))

vi.mock('../../stores/dev-server', () => ({
  useDevServerStore: (selector?: (s: unknown) => unknown) =>
    selector ? selector(mockDevServerStore()) : mockDevServerStore(),
}))

vi.mock('../../hooks/useGitStatus', () => ({
  useGitStatus: (...args: unknown[]) => mockUseGitStatus(...args),
}))

vi.mock('../shared/MetadataEntries', () => ({
  MetadataSectionHeader: ({ title: t }: { title: string }) => `[MSH:${t}]`,
  MetadataEntries: () => null,
}))

vi.mock('../shared/icons', () => ({
  FolderIcon: () => '[FolderIcon]',
  BranchIcon: () => '[BranchIcon]',
  ChevronDownIcon: () => '[ChevronDownIcon]',
  StopIcon: () => '[StopIcon]',
  OpenExternalIcon: () => '[OpenExternalIcon]',
  PlayIcon: () => '[PlayIcon]',
}))

vi.mock('./CriteriaEditor', () => ({ CriteriaEditor: () => null }))
vi.mock('./DiffViewer', () => ({ DiffViewer: () => '[DiffViewer]' }))
vi.mock('./DevServerFooter', () => ({ DevServerFooter: () => '[DevServerFooter]' }))
vi.mock('./BranchModal', () => ({ BranchModal: () => null }))
vi.mock('./WorkspaceModal', () => ({ WorkspaceModal: () => null }))

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function mockMetadataEntries(overrides?: Record<string, unknown>) {
  return {
    criteria: [
      { id: 'c1', description: 'do thing', status: 'passed' },
      { id: 'c2', description: 'do other', status: 'open' },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()

  mockSessionStore.mockReturnValue({
    currentSession: {
      id: 's1',
      projectId: 'p1',
      metadataEntries: mockMetadataEntries(),
      workspace: '/tmp/proj/my-workspace',
      workdir: '/tmp/proj',
    },
  })

  mockDevServerStore.mockReturnValue({
    status: {
      state: 'off',
      url: null,
      hotReload: false,
      config: null,
      errorMessage: undefined,
      inspectProxyPort: null,
    },
    config: null,
  })

  mockUseGitStatus.mockReturnValue({
    branch: 'main',
    diff: { files: [{ path: 'a.ts', status: 'modified', additions: 3, deletions: 1 }], loading: false, error: null },
  })
})

afterEach(cleanup)

/* ------------------------------------------------------------------ */
/*  Static rendering tests                                            */
/* ------------------------------------------------------------------ */

describe('SidebarSummaryHeader', () => {
  it('renders nothing when visible is false', () => {
    const html = renderToStaticMarkup(<SidebarSummaryHeader visible={false} />)
    expect(html).toBe('')
  })

  it('renders nothing when session is null', () => {
    mockSessionStore.mockReturnValue({ currentSession: null })
    const html = renderToStaticMarkup(<SidebarSummaryHeader visible={true} />)
    expect(html).toBe('')
  })

  it('renders three columns when visible is true', () => {
    const html = renderToStaticMarkup(<SidebarSummaryHeader visible={true} />)
    expect(html).toContain('✓')
    expect(html).toContain('○')
    expect(html).toContain('my-workspace')
    expect(html).toContain('main')
    expect(html).toContain('No config')
  })

  it('shows criteria counts grouped by status', () => {
    const html = renderToStaticMarkup(<SidebarSummaryHeader visible={true} />)
    expect(html).toContain('1')
  })

  it('shows +N badge when review_findings or todos have entries', () => {
    mockSessionStore.mockReturnValue({
      currentSession: {
        id: 's1',
        projectId: 'p1',
        metadataEntries: mockMetadataEntries({
          review_findings: [{ id: 'r1', description: 'found issue', status: 'open' }],
          todos: [{ id: 't1', description: 'fix it', status: 'pending' }],
        }),
        workspace: '/tmp/proj/my-workspace',
        workdir: '/tmp/proj',
      },
    })

    const html = renderToStaticMarkup(<SidebarSummaryHeader visible={true} />)
    expect(html).toContain('+2')
  })

  it('shows +N badge with title for custom metadata keys', () => {
    mockSessionStore.mockReturnValue({
      currentSession: {
        id: 's1',
        projectId: 'p1',
        metadataEntries: mockMetadataEntries({
          custom_notes: [{ id: 'n1', description: 'note', status: 'open' }],
        }),
        workspace: '/tmp/proj/my-workspace',
        workdir: '/tmp/proj',
      },
    })

    const html = renderToStaticMarkup(<SidebarSummaryHeader visible={true} />)
    expect(html).toContain('+1')
    expect(html).toContain('Custom Notes')
  })

  it('shows workspace name and branch', () => {
    const html = renderToStaticMarkup(<SidebarSummaryHeader visible={true} />)
    expect(html).toContain('my-workspace')
    expect(html).toContain('main')
  })

  it('shows diff change summary', () => {
    const html = renderToStaticMarkup(<SidebarSummaryHeader visible={true} />)
    expect(html).toContain('+3')
    expect(html).toContain('-1')
  })

  it('shows dev server Start button when off', () => {
    mockDevServerStore.mockReturnValue({
      status: {
        state: 'off',
        url: null,
        hotReload: false,
        config: null,
        errorMessage: undefined,
        inspectProxyPort: null,
      },
      config: { command: 'npm run dev', url: 'http://localhost:3000', hotReload: false },
    })

    const html = renderToStaticMarkup(<SidebarSummaryHeader visible={true} />)
    expect(html).toContain('Start')
  })

  it('shows dev server icon-only Open button when running', () => {
    mockDevServerStore.mockReturnValue({
      status: {
        state: 'running',
        url: 'http://localhost:3000',
        hotReload: false,
        config: { command: 'npm run dev', url: 'http://localhost:3000', hotReload: false },
        errorMessage: undefined,
        inspectProxyPort: null,
      },
      config: { command: 'npm run dev', url: 'http://localhost:3000', hotReload: false },
    })

    const html = renderToStaticMarkup(<SidebarSummaryHeader visible={true} />)
    expect(html).toContain('[OpenExternalIcon]')
  })

  it('shows dev server icon-only Open button in warning state', () => {
    mockDevServerStore.mockReturnValue({
      status: {
        state: 'warning',
        url: 'http://localhost:3000',
        hotReload: false,
        config: { command: 'npm run dev', url: 'http://localhost:3000', hotReload: false },
        errorMessage: 'Something is off',
        inspectProxyPort: null,
      },
      config: { command: 'npm run dev', url: 'http://localhost:3000', hotReload: false },
    })

    const html = renderToStaticMarkup(<SidebarSummaryHeader visible={true} />)
    expect(html).toContain('[OpenExternalIcon]')
  })

  it('shows dev server error state', () => {
    mockDevServerStore.mockReturnValue({
      status: {
        state: 'error',
        url: null,
        hotReload: false,
        config: { command: 'npm run dev', url: 'http://localhost:3000', hotReload: false },
        errorMessage: 'Failed to start',
        inspectProxyPort: null,
      },
      config: { command: 'npm run dev', url: 'http://localhost:3000', hotReload: false },
    })

    const html = renderToStaticMarkup(<SidebarSummaryHeader visible={true} />)
    expect(html).toContain('Start')
  })

  it('does not include session stats', () => {
    const html = renderToStaticMarkup(<SidebarSummaryHeader visible={true} />)
    expect(html).not.toContain('pp')
    expect(html).not.toContain('tg')
  })

  it('shows ChevronDownIcon for each column', () => {
    const html = renderToStaticMarkup(<SidebarSummaryHeader visible={true} />)
    const matches = html.match(/\[ChevronDownIcon\]/g)
    expect(matches).toHaveLength(3)
  })

  it('shows "original" when no workspace name is set', () => {
    mockSessionStore.mockReturnValue({
      currentSession: {
        id: 's1',
        projectId: 'p1',
        metadataEntries: mockMetadataEntries(),
        workspace: null,
        workdir: '/tmp/proj',
      },
    })

    const html = renderToStaticMarkup(<SidebarSummaryHeader visible={true} />)
    expect(html).toContain('original')
  })

  it('shows nothing when diff is empty', () => {
    mockUseGitStatus.mockReturnValue({
      branch: 'main',
      diff: { files: [], loading: false, error: null },
    })

    const html = renderToStaticMarkup(<SidebarSummaryHeader visible={true} />)
    expect(html).not.toContain('+3 -1')
  })
})

/* ------------------------------------------------------------------ */
/*  Interaction tests                                                 */
/* ------------------------------------------------------------------ */

describe('SidebarSummaryHeader — popover interactions', () => {
  it('opens workspace popover on trigger click', () => {
    render(<SidebarSummaryHeader visible={true} />)
    const triggers = screen.getAllByRole('button')
    expect(triggers.length).toBeGreaterThanOrEqual(3)
    fireEvent.click(triggers[0]!)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('opens metadata popover on trigger click', () => {
    render(<SidebarSummaryHeader visible={true} />)
    const triggers = screen.getAllByRole('button')
    fireEvent.click(triggers[1]!)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('opens dev server popover on trigger click', () => {
    render(<SidebarSummaryHeader visible={true} />)
    const triggers = screen.getAllByRole('button')
    fireEvent.click(triggers[2]!)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('closes popover on Escape key', () => {
    render(<SidebarSummaryHeader visible={true} />)
    const triggers = screen.getAllByRole('button')
    fireEvent.click(triggers[0]!)
    expect(screen.queryByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens popover on Enter key', () => {
    render(<SidebarSummaryHeader visible={true} />)
    const triggers = screen.getAllByRole('button')
    fireEvent.keyDown(triggers[0]!, { key: 'Enter' })
    expect(screen.queryByRole('dialog')).toBeTruthy()
  })

  it('opens popover on Space key', () => {
    render(<SidebarSummaryHeader visible={true} />)
    const triggers = screen.getAllByRole('button')
    fireEvent.keyDown(triggers[0]!, { key: ' ' })
    expect(screen.queryByRole('dialog')).toBeTruthy()
  })
})
