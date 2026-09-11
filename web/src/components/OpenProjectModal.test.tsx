// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OpenProjectModal } from './CreateSessionModal'
import { useProjects } from '../hooks/useProjects'
import { useProjectStore } from '../stores/project'
import type { Project } from '@shared/types.js'

vi.mock('../hooks/useProjects', () => ({
  useProjects: vi.fn(),
}))

vi.mock('../stores/project', () => ({
  useProjectStore: vi.fn(),
}))

vi.mock('../hooks/useWorkdir', () => ({
  useWorkdir: () => '/home/user',
}))

vi.mock('../hooks/useT', () => ({
  useT: () => (obj: { en: string; fr: string }) => obj.en,
}))

vi.mock('wouter', () => ({
  useLocation: () => ['/', vi.fn()],
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}))

describe('OpenProjectModal', () => {
  const mockProjects: Project[] = [
    { id: 'p1', name: 'OpenFox Project', workdir: '/home/user/openfox', createdAt: '', updatedAt: '' },
    { id: 'p2', name: 'My Website', workdir: '/home/user/website', createdAt: '', updatedAt: '' },
    { id: 'p3', name: 'Backend API', workdir: '/home/user/backend', createdAt: '', updatedAt: '' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useProjects).mockReturnValue({
      projects: mockProjects,
      refresh: vi.fn(),
      loading: false,
    })
    vi.mocked(useProjectStore).mockImplementation((selector: any) =>
      selector({
        createProject: vi.fn(),
        deleteProject: vi.fn(),
      }),
    )
  })

  it('renders search input when projects exist and filters projects by name', () => {
    render(<OpenProjectModal isOpen={true} onClose={vi.fn()} />)

    expect(screen.getByText('OpenFox Project')).toBeDefined()
    expect(screen.getByText('My Website')).toBeDefined()
    expect(screen.getByText('Backend API')).toBeDefined()

    const searchInput = screen.getByPlaceholderText('Search projects…')
    expect(searchInput).toBeDefined()

    // Filter by name
    fireEvent.change(searchInput, { target: { value: 'website' } })
    expect(screen.getByText('My Website')).toBeDefined()
    expect(screen.queryByText('OpenFox Project')).toBeNull()
    expect(screen.queryByText('Backend API')).toBeNull()

    // Filter by another name
    fireEvent.change(searchInput, { target: { value: 'backend' } })
    expect(screen.getByText('Backend API')).toBeDefined()
    expect(screen.queryByText('OpenFox Project')).toBeNull()
    expect(screen.queryByText('My Website')).toBeNull()

    // No matches
    fireEvent.change(searchInput, { target: { value: 'nomatch' } })
    expect(screen.getByText('No projects match')).toBeDefined()
  })
})
