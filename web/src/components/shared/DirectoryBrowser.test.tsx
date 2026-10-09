// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirectoryBrowser } from './DirectoryBrowser'
import { DRIVES_VIEW } from '@shared/directory'

const authFetch = vi.fn()

vi.mock('../../lib/api', () => ({ authFetch: (url: string) => authFetch(url) }))

function mockListing(url: string) {
  const current = url.includes('%2Froot%2Fchild') ? '/root/child' : '/root'
  return {
    current,
    parent: current === '/root/child' ? '/root' : '/',
    directories: current === '/root' ? [{ name: 'child', path: '/root/child' }] : [],
    drives: [
      { name: 'C:', path: 'C:\\' },
      { name: 'D:', path: 'D:\\' },
    ],
  }
}

function mockDrivesView() {
  return {
    current: DRIVES_VIEW,
    parent: null,
    directories: [
      { name: 'C:', path: 'C:\\' },
      { name: 'D:', path: 'D:\\' },
    ],
    drives: [
      { name: 'C:', path: 'C:\\' },
      { name: 'D:', path: 'D:\\' },
    ],
    basename: DRIVES_VIEW,
  }
}

describe('DirectoryBrowser', () => {
  afterEach(cleanup)

  beforeEach(() => {
    authFetch.mockReset()
    authFetch.mockImplementation(async (url: string) => ({
      json: async () => (url.includes('/api/directories/drives') ? mockDrivesView() : mockListing(url)),
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

  it('shows a Drives breadcrumb when the listing exposes drives', async () => {
    render(<DirectoryBrowser initialPath="/root" onSelect={vi.fn()} onClose={vi.fn()} />)

    const drivesCrumb = await screen.findByRole('button', { name: 'Drives' })
    fireEvent.click(drivesCrumb)

    await waitFor(() => expect(authFetch).toHaveBeenCalledWith('/api/directories/drives'))
  })

  it('renders the drives view and navigates into a drive on row click', async () => {
    const onSelect = vi.fn()
    render(<DirectoryBrowser initialPath={DRIVES_VIEW} onSelect={onSelect} onClose={vi.fn()} />)

    const driveRow = await screen.findByRole('button', { name: 'D:' })
    fireEvent.click(driveRow)

    await waitFor(() => expect(authFetch).toHaveBeenCalledWith('/api/directories?path=D%3A%5C'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('selects a drive from the drives view', async () => {
    const onSelect = vi.fn()
    render(<DirectoryBrowser initialPath={DRIVES_VIEW} onSelect={onSelect} onClose={vi.fn()} />)

    await screen.findByText('D:')

    fireEvent.click(screen.getByRole('button', { name: 'Select D:' }))

    expect(onSelect).toHaveBeenCalledWith('D:\\')
  })

  it('ascends to the drives view from a drive root via the parent row', async () => {
    const onSelect = vi.fn()
    render(<DirectoryBrowser initialPath="/root" onSelect={onSelect} onClose={vi.fn()} />)

    const parentRow = await screen.findByRole('button', { name: '..' })
    fireEvent.click(parentRow)

    await waitFor(() => expect(authFetch).toHaveBeenCalledWith('/api/directories?path=%2Froot'))
    const drivesCrumb = await screen.findByRole('button', { name: 'Drives' })
    fireEvent.click(drivesCrumb)

    await waitFor(() => expect(authFetch).toHaveBeenCalledWith('/api/directories/drives'))
  })
})
