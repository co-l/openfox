// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DiffViewer } from './DiffViewer'
import { SETTINGS_KEYS, settingResource } from '../../lib/resources'
import { clearCache } from '../../lib/resourceCache'
import { configResource } from '../../lib/resources'

function seedConfig(platform: { isWSL: boolean; wslDistro: string } | null): void {
  configResource.write({
    version: null,
    model: null,
    maxContext: 200000,
    llmUrl: null,
    llmStatus: 'unknown',
    backend: 'unknown',
    defaultModelSelection: null,
    visionFallback: null,
    platform,
    workdir: null,
    locale: 'automatic',
  })
}

vi.mock('../../hooks/useGitStatus', () => ({
  useGitStatus: vi.fn(() => ({
    branch: 'main',
    diff: {
      files: [
        { path: 'src/foo.ts', status: 'modified', additions: 3, deletions: 1 },
        { path: 'src/bar.ts', status: 'added', additions: 10, deletions: 0 },
        { path: 'src/baz.ts', status: 'deleted', additions: 0, deletions: 5 },
      ],
      loading: false,
    },
    error: null,
    loading: false,
  })),
}))

vi.mock('../../stores/session', () => ({
  useSessionStore: vi.fn((selector) => {
    const state = {
      currentSession: {
        id: 'test-session',
        projectId: 'test-project',
        workdir: '/home/user/project',
        messages: [],
      },
    }
    return selector(state)
  }),
}))

beforeEach(() => {
  cleanup()
  clearCache()
  seedConfig(null)
})

describe('DiffViewer', () => {
  it('renders file paths from git status', () => {
    render(<DiffViewer />)
    expect(screen.getByText('src/foo.ts')).toBeTruthy()
    expect(screen.getByText('src/bar.ts')).toBeTruthy()
    expect(screen.getByText('src/baz.ts')).toBeTruthy()
  })

  it('does not render VSCode links when setting is disabled', () => {
    render(<DiffViewer />)
    expect(screen.queryByTitle(/Open .+ in VSCode/)).toBeNull()
  })

  it('renders VSCode links when setting is enabled', () => {
    settingResource.write('true', SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR)
    render(<DiffViewer />)
    const links = screen.getAllByTitle(/Open .+ in VSCode/)
    expect(links.length).toBeGreaterThan(0)
    expect(links[0]).toHaveAttribute('href')
  })

  it('renders VSCode links with workspace path resolved', () => {
    seedConfig({ isWSL: false, wslDistro: '' })
    settingResource.write('true', SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR)
    render(<DiffViewer />)
    const link = screen.getByTitle('Open src/foo.ts in VSCode')
    expect(link).toHaveAttribute('href', 'vscode://file//home/user/project/src/foo.ts')
  })

  it('renders WSL links when platform is WSL', () => {
    seedConfig({ isWSL: true, wslDistro: 'Ubuntu' })
    settingResource.write('true', SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR)
    render(<DiffViewer />)
    const link = screen.getByTitle('Open src/foo.ts in VSCode')
    expect(link).toHaveAttribute('href', 'vscode://vscode-remote/wsl+Ubuntu/home/user/project/src/foo.ts:1')
  })
})
