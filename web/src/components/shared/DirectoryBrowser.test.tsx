// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirectoryBrowser } from './DirectoryBrowser'

const authFetch = vi.fn()

vi.mock('../../lib/api', () => ({ authFetch: (url: string) => authFetch(url) }))

function mockListing(url: string) {
  const current = url.includes('%2Froot%2Fchild') ? '/root/child' : '/root'
  return {
    current,
    parent: current === '/root/child' ? '/root' : '/',
    directories: current === '/root' ? [{ name: 'child', path: '/root/child' }] : [],
  }
}

describe('DirectoryBrowser', () => {
  afterEach(cleanup)

  beforeEach(() => {
    authFetch.mockReset()
    authFetch.mockImplementation(async (url: string) => ({
      json: async () => mockListing(url),
    }))
  })

  it('navigates into a folder on row click', async () => {
    const onSelect = vi.fn()
    render(<DirectoryBrowser initialPath="/root" onSelect={onSelect} onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'child' }))

    await waitFor(() => expect(authFetch).toHaveBeenCalledWith('/api/directories?path=%2Froot%2Fchild'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('selects a folder via the per-row Select button', async () => {
    const onSelect = vi.fn()
    render(<DirectoryBrowser initialPath="/root" onSelect={onSelect} onClose={vi.fn()} />)

    await screen.findByText('child')

    fireEvent.click(screen.getByRole('button', { name: 'Select child' }))

    expect(onSelect).toHaveBeenCalledWith('/root/child')
  })

  it('selects the current folder via the top breadcrumb button', async () => {
    const onSelect = vi.fn()
    render(<DirectoryBrowser initialPath="/root" onSelect={onSelect} onClose={vi.fn()} />)

    const button = await screen.findByRole('button', { name: 'Select' })
    fireEvent.click(button)
    expect(onSelect).toHaveBeenCalledWith('/root')
  })
})
