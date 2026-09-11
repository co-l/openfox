// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BranchModal } from './BranchModal'
import { sessionBranchesResource } from '../../lib/resources'
import { authFetch } from '../../lib/api'

vi.mock('../../lib/resources', () => ({
  sessionBranchesResource: {
    refresh: vi.fn(),
  },
}))

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(),
}))

vi.mock('../../hooks/useT', () => ({
  useT: () => (obj: { en: string; fr: string }) => obj.en,
}))

describe('BranchModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders branch list and allows filtering with search field', async () => {
    vi.mocked(sessionBranchesResource.refresh).mockResolvedValue({
      branches: [
        { name: 'main', current: true },
        { name: 'feature/login', current: false },
        { name: 'feature/payment', current: false },
        { name: 'bugfix/header', current: false },
      ],
      defaultBranch: 'main',
    })

    render(<BranchModal isOpen={true} onClose={vi.fn()} sessionId="s1" />)

    await waitFor(() => {
      expect(screen.getByText('feature/login')).toBeDefined()
    })

    const searchInput = screen.getByPlaceholderText('Search branches…')
    expect(searchInput).toBeDefined()

    fireEvent.change(searchInput, { target: { value: 'pay' } })

    expect(screen.getByText('feature/payment')).toBeDefined()
    expect(screen.queryByText('feature/login')).toBeNull()
    expect(screen.queryByText('bugfix/header')).toBeNull()

    fireEvent.change(searchInput, { target: { value: 'nonexistent' } })
    expect(screen.getByText('No branches match')).toBeDefined()
  })

  it('switches branch when a non-current branch is clicked', async () => {
    const onClose = vi.fn()
    vi.mocked(sessionBranchesResource.refresh).mockResolvedValue({
      branches: [
        { name: 'main', current: true },
        { name: 'feature/login', current: false },
      ],
      defaultBranch: 'main',
    })
    vi.mocked(authFetch).mockResolvedValue({ ok: true } as any)

    render(<BranchModal isOpen={true} onClose={onClose} sessionId="s1" />)

    await waitFor(() => {
      expect(screen.getByText('feature/login')).toBeDefined()
    })

    fireEvent.click(screen.getByText('feature/login'))

    await waitFor(() => {
      expect(authFetch).toHaveBeenCalledWith('/api/sessions/s1/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: 'feature/login' }),
      })
      expect(onClose).toHaveBeenCalled()
    })
  })
})
