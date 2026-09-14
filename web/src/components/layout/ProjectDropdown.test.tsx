// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProjectDropdown } from './ProjectDropdown'
import { useProjectStore } from '../../stores/project'

vi.mock('../../stores/project', () => ({
  useProjectStore: vi.fn(),
}))

vi.mock('../../hooks/useWorkdir', () => ({
  useWorkdir: () => '/home/user',
}))

vi.mock('../../hooks/useT', () => ({
  useT: () => (obj: { en: string; fr: string }) => obj.en,
}))

vi.mock('wouter', () => ({
  useLocation: () => ['/', vi.fn()],
  Link: ({ children, href, onClick }: any) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}))

describe('ProjectDropdown', () => {
  const mockProjects = [
    { id: 'p1', name: 'Alpha Project', workdir: '/home/user/alpha', isStarred: false },
    { id: 'p2', name: 'Beta App', workdir: '/home/user/beta', isStarred: true },
    { id: 'p3', name: 'Gamma Service', workdir: '/home/user/gamma', isStarred: false },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useProjectStore).mockImplementation((selector: any) =>
      selector({
        setCurrentProjectId: vi.fn(),
        toggleStar: vi.fn(),
        createProject: vi.fn(),
      }),
    )
  })

  it('renders search input when opened and filters projects by name', () => {
    render(<ProjectDropdown projects={mockProjects} />)

    // Open dropdown
    const trigger = screen.getByTitle('Select project')
    fireEvent.click(trigger)

    expect(screen.getByText('Alpha Project')).toBeDefined()
    expect(screen.getByText('Beta App')).toBeDefined()
    expect(screen.getByText('Gamma Service')).toBeDefined()

    const searchInput = screen.getByPlaceholderText('Search projects…')
    expect(searchInput).toBeDefined()

    // Filter by name
    fireEvent.change(searchInput, { target: { value: 'beta' } })
    expect(screen.getByText('Beta App')).toBeDefined()
    expect(screen.queryByText('Alpha Project')).toBeNull()
    expect(screen.queryByText('Gamma Service')).toBeNull()

    // No matches
    fireEvent.change(searchInput, { target: { value: 'nomatch' } })
    expect(screen.getByText('No projects match')).toBeDefined()
  })
})
