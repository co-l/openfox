// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DirectoryBrowser } from './DirectoryBrowser'

const authFetch = vi.fn(async (url: string) => {
  const current = url.includes('%2Froot%2Fchild') ? '/root/child' : '/root'
  return {
    json: async () => ({
      current,
      parent: current === '/root/child' ? '/root' : '/',
      directories: current === '/root' ? [{ name: 'child', path: '/root/child' }] : [],
    }),
  }
})

vi.mock('../../lib/api', () => ({ authFetch: (url: string) => authFetch(url) }))

describe('DirectoryBrowser', () => {
  it('navigates folders without selecting until the confirmation button is clicked', async () => {
    const onSelect = vi.fn()
    render(<DirectoryBrowser initialPath="/root" onSelect={onSelect} onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'child' }))

    await waitFor(() => expect(authFetch).toHaveBeenCalledWith('/api/directories?path=%2Froot%2Fchild'))
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Select this folder' }))
    expect(onSelect).toHaveBeenCalledWith('/root/child')
  })
})
