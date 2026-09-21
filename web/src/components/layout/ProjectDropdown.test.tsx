// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
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
  Link: ({ children, href, onClick, className }: any) => (
    <a href={href} onClick={onClick} className={className}>
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

  it('keeps focus in the search input while typing', async () => {
    render(<ProjectDropdown projects={mockProjects} />)

    fireEvent.click(screen.getByTitle('Select project'))
    const searchInput = screen.getByPlaceholderText('Search projects…') as HTMLInputElement

    act(() => {
      searchInput.focus()
    })
    expect(document.activeElement).toBe(searchInput)

    act(() => {
      fireEvent.change(searchInput, { target: { value: 'a' } })
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(document.activeElement).toBe(searchInput)
  })

  it('keeps the keyboard selection stable while filtering', () => {
    const projects = [
      { id: 'p1', name: 'Alpha Project', workdir: '/home/user/alpha', isStarred: false },
      { id: 'p2', name: 'Beta Project', workdir: '/home/user/beta', isStarred: false },
      { id: 'p3', name: 'Delta Project', workdir: '/home/user/delta', isStarred: false },
      { id: 'p4', name: 'Gamma Project', workdir: '/home/user/gamma', isStarred: false },
    ]
    render(<ProjectDropdown projects={projects} />)

    fireEvent.click(screen.getByTitle('Select project'))
    fireEvent.keyDown(window, { key: 'ArrowDown' })

    const searchInput = screen.getByPlaceholderText('Search projects…')
    fireEvent.change(searchInput, { target: { value: 'a' } })

    // All four projects match 'a', so the selected second item (Beta Project) must stay selected
    expect(screen.getByText('Beta Project').closest('a')?.className).toContain('bg-accent-primary/20')
    expect(screen.getByText('Alpha Project').closest('a')?.className).not.toContain('bg-accent-primary/20')
  })

  it('clamps the selection out of the footer region when filtering shrinks the list', () => {
    render(<ProjectDropdown projects={mockProjects} />)

    // Sorted: Beta App (starred), Alpha Project, Gamma Service — ArrowDown selects Alpha (index 1)
    fireEvent.click(screen.getByTitle('Select project'))
    fireEvent.keyDown(window, { key: 'ArrowDown' })

    const searchInput = screen.getByPlaceholderText('Search projects…')
    fireEvent.change(searchInput, { target: { value: 'beta' } })

    // Only Beta App remains: the selection (index 1) must land on it, not on the first footer item
    expect(screen.getByText('Beta App').closest('a')?.className).toContain('bg-accent-primary/20')
    expect(screen.getByText('Home').closest('a')?.className).not.toContain('bg-accent-primary/20')
  })

  it('auto-focuses the search input when opened on desktop', async () => {
    render(<ProjectDropdown projects={mockProjects} />)

    fireEvent.click(screen.getByTitle('Select project'))
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(document.activeElement).toBe(screen.getByPlaceholderText('Search projects…'))
  })

  it('does not auto-focus anything when opened on a coarse-pointer (mobile) device', async () => {
    const mobileMedia = {
      matches: true,
      media: '(hover: none) and (pointer: coarse)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }
    const spy = vi.spyOn(window, 'matchMedia').mockReturnValue(mobileMedia as MediaQueryList)

    render(<ProjectDropdown projects={mockProjects} />)
    fireEvent.click(screen.getByTitle('Select project'))
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(document.activeElement).not.toBe(screen.getByPlaceholderText('Search projects…'))
    expect(document.activeElement).not.toBe(document.querySelector('[data-testid="session-dropdown-menu"]'))

    spy.mockRestore()
  })

  it('keeps a footer selection when the item list re-renders', () => {
    const utils = render(<ProjectDropdown projects={mockProjects} />)

    fireEvent.click(screen.getByTitle('Select project'))
    // 3 main items (0-2), 3 footer items (3-5): three ArrowDowns select "Home"
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(screen.getByText('Home').closest('a')?.className).toContain('bg-accent-primary/20')

    // Same content, new array identity — what a keystroke or star toggle produces
    utils.rerender(<ProjectDropdown projects={[...mockProjects]} />)

    expect(screen.getByText('Home').closest('a')?.className).toContain('bg-accent-primary/20')
  })
})
