// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DiffViewer } from './DiffViewer'
import { useSettingsStore, SETTINGS_KEYS } from '../../stores/settings'
import { useConfigStore } from '../../stores/config'

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
  useConfigStore.setState({ platform: null })
  useSettingsStore.setState({ settings: {} })
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
    useSettingsStore.setState((s) => ({
      settings: { ...s.settings, [SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR]: 'true' },
    }))
    render(<DiffViewer />)
    const links = screen.getAllByTitle(/Open .+ in VSCode/)
    expect(links.length).toBeGreaterThan(0)
    expect(links[0]).toHaveAttribute('href')
  })

  it('renders VSCode links with workspace path resolved', () => {
    useConfigStore.setState({ platform: { isWSL: false, wslDistro: '' } })
    useSettingsStore.setState((s) => ({
      settings: { ...s.settings, [SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR]: 'true' },
    }))
    render(<DiffViewer />)
    const link = screen.getByTitle('Open src/foo.ts in VSCode')
    expect(link).toHaveAttribute('href', 'vscode://file//home/user/project/src/foo.ts')
  })

  it('renders WSL links when platform is WSL', () => {
    useConfigStore.setState({ platform: { isWSL: true, wslDistro: 'Ubuntu' } })
    useSettingsStore.setState((s) => ({
      settings: { ...s.settings, [SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR]: 'true' },
    }))
    render(<DiffViewer />)
    const link = screen.getByTitle('Open src/foo.ts in VSCode')
    expect(link).toHaveAttribute('href', 'vscode://vscode-remote/wsl+Ubuntu/home/user/project/src/foo.ts:1')
  })
})
