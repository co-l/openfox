// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { AtMentionAutocomplete, type AtMentionAutocompleteHandle } from './AtMentionAutocomplete'
import { authFetch } from '../../lib/api'

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(),
}))

const mockedAuthFetch = vi.mocked(authFetch)

interface FileSuggestion {
  path: string
  name: string
  type: 'file' | 'directory'
  score: number
}

const SUGGESTIONS: FileSuggestion[] = [
  { path: 'README.md', name: 'README.md', type: 'file', score: 1 },
  { path: 'src/READMORE.ts', name: 'READMORE.ts', type: 'file', score: 0.8 },
  { path: 'docs/READ', name: 'READ', type: 'directory', score: 0.5 },
]

function makeResponse(data: unknown): Response {
  return { json: async () => data } as Response
}

function render(ui: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(ui)
  })
  return {
    container,
    rerender: (next: React.ReactElement) =>
      act(() => {
        root.render(next)
      }),
  }
}

function makeRef(): { current: AtMentionAutocompleteHandle | null } {
  return { current: null }
}

function keyEvent(key: string): React.KeyboardEvent {
  return { key, preventDefault: vi.fn() } as unknown as React.KeyboardEvent
}

async function waitForSuggestions(container: HTMLElement) {
  await waitFor(() => {
    expect(container.querySelector('li')).toBeTruthy()
  })
}

describe('AtMentionAutocomplete', () => {
  beforeEach(() => {
    mockedAuthFetch.mockReset()
    mockedAuthFetch.mockResolvedValue(makeResponse(SUGGESTIONS))
    document.body.innerHTML = ''
  })

  it('renders nothing when there is no @ mention under the cursor', () => {
    const { container } = render(
      <AtMentionAutocomplete text="hello world" cursorPos={11} onSelect={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
    expect(mockedAuthFetch).not.toHaveBeenCalled()
  })

  it('renders nothing before the debounced fetch fires (suggestions empty, not loading)', () => {
    const { container } = render(
      <AtMentionAutocomplete text="@REA" cursorPos={4} onSelect={vi.fn()} />,
    )
    expect(container.querySelector('li')).toBeNull()
  })

  it('fetches suggestions for the query after the debounce and renders them', async () => {
    const { container } = render(
      <AtMentionAutocomplete text="@REA" cursorPos={4} onSelect={vi.fn()} />,
    )
    await waitForSuggestions(container)
    expect(mockedAuthFetch).toHaveBeenCalledWith('/api/files?q=REA')
    expect(container.textContent).toContain('README.md')
    expect(container.textContent).toContain('src/READMORE.ts')
    expect(container.textContent).toContain('docs/READ')
  })

  it('renders nothing when the fetch resolves with an empty list', async () => {
    mockedAuthFetch.mockResolvedValue(makeResponse([]))
    const { container } = render(
      <AtMentionAutocomplete text="@REA" cursorPos={4} onSelect={vi.fn()} />,
    )
    await waitFor(() => {
      expect(mockedAuthFetch).toHaveBeenCalledWith('/api/files?q=REA')
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(container.querySelector('li')).toBeNull()
  })

  it('calls onSelect with the suggestion and startIndex when a suggestion is clicked', async () => {
    const onSelect = vi.fn()
    const { container } = render(
      <AtMentionAutocomplete text="@REA" cursorPos={4} onSelect={onSelect} />,
    )
    await waitForSuggestions(container)
    const items = container.querySelectorAll('li')
    fireEvent.click(items[1]!)
    expect(onSelect).toHaveBeenCalledWith(SUGGESTIONS[1], 0)
  })
  it('passes the full directory suggestion when a directory is clicked', async () => {
    const onSelect = vi.fn()
    const { container } = render(
      <AtMentionAutocomplete text="@REA" cursorPos={4} onSelect={onSelect} />,
    )
    await waitForSuggestions(container)
    const items = container.querySelectorAll('li')
    // docs/READ is a directory (index 2); the parent uses its type to navigate
    fireEvent.click(items[2]!)
    expect(onSelect).toHaveBeenCalledWith(SUGGESTIONS[2], 0)
  })

  it('keeps the popup open and refetches when the query is a directory path', async () => {
    // After selecting the "src" directory, ChatInput inserts "@src/" with the cursor
    // after the slash; the slash does not terminate the mention, so the popup must
    // stay open and fetch the directory's contents.
    mockedAuthFetch.mockResolvedValue(
      makeResponse([
        { path: 'src/index.ts', name: 'index.ts', type: 'file', score: 1 },
        { path: 'src/components', name: 'components', type: 'directory', score: 1 },
      ]),
    )
    const { container } = render(
      <AtMentionAutocomplete text="@src/" cursorPos={5} onSelect={vi.fn()} />,
    )
    await waitForSuggestions(container)
    expect(mockedAuthFetch).toHaveBeenCalledWith('/api/files?q=src%2F')
    expect(container.textContent).toContain('src/index.ts')
    expect(container.textContent).toContain('src/components')
  })

  it('clears suggestions on Escape via the imperative handle', async () => {
    const ref = makeRef()
    const { container } = render(
      <AtMentionAutocomplete ref={ref} text="@REA" cursorPos={4} onSelect={vi.fn()} />,
    )
    await waitForSuggestions(container)
    act(() => {
      ref.current!.handleKeyDown(keyEvent('Escape'))
    })
    expect(container.querySelector('li')).toBeNull()
  })

  it('selects the highlighted (first) suggestion on Enter', async () => {
    const ref = makeRef()
    const onSelect = vi.fn()
    render(
      <AtMentionAutocomplete ref={ref} text="@REA" cursorPos={4} onSelect={onSelect} />,
    )
    await waitForSuggestions(document.body)
    act(() => {
      ref.current!.handleKeyDown(keyEvent('Enter'))
    })
    expect(onSelect).toHaveBeenCalledWith(SUGGESTIONS[0], 0)
  })

  it('moves selection down with ArrowDown and selects the second item on Enter', async () => {
    const ref = makeRef()
    const onSelect = vi.fn()
    const { container } = render(
      <AtMentionAutocomplete ref={ref} text="@REA" cursorPos={4} onSelect={onSelect} />,
    )
    await waitForSuggestions(container)
    act(() => {
      ref.current!.handleKeyDown(keyEvent('ArrowDown'))
    })
    // selectedIndexRef is synced via useEffect, so the ArrowDown must commit
    // (re-render + effect flush) before Enter reads it — mirroring real ticks.
    act(() => {
      ref.current!.handleKeyDown(keyEvent('Enter'))
    })
    expect(onSelect).toHaveBeenCalledWith(SUGGESTIONS[1], 0)
  })

  it('clamps at the first item on ArrowUp (still selects the first on Enter)', async () => {
    const ref = makeRef()
    const onSelect = vi.fn()
    const { container } = render(
      <AtMentionAutocomplete ref={ref} text="@REA" cursorPos={4} onSelect={onSelect} />,
    )
    await waitForSuggestions(container)
    act(() => {
      ref.current!.handleKeyDown(keyEvent('ArrowUp'))
      ref.current!.handleKeyDown(keyEvent('Enter'))
    })
    expect(onSelect).toHaveBeenCalledWith(SUGGESTIONS[0], 0)
  })

  it('does not call onSelect on Enter when there are no suggestions', async () => {
    mockedAuthFetch.mockResolvedValue(makeResponse([]))
    const ref = makeRef()
    const onSelect = vi.fn()
    render(
      <AtMentionAutocomplete ref={ref} text="@REA" cursorPos={4} onSelect={onSelect} />,
    )
    await waitFor(() => expect(mockedAuthFetch).toHaveBeenCalled())
    act(() => {
      ref.current!.handleKeyDown(keyEvent('Enter'))
    })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('renders nothing and does not fetch when the cursor sits past a trailing space (post-selection state)', () => {
    // Reproduces the contract that keeps the popup closed after ChatInput.handleSelectFile
    // inserts "@README.md " and positions the cursor after the trailing space.
    const { container } = render(
      <AtMentionAutocomplete text="@README.md " cursorPos={11} onSelect={vi.fn()} />,
    )
    expect(container.querySelector('li')).toBeNull()
    expect(mockedAuthFetch).not.toHaveBeenCalled()
  })

  it('refetches when the query grows on rerender', async () => {
    const { container, rerender } = render(
      <AtMentionAutocomplete text="@REA" cursorPos={4} onSelect={vi.fn()} />,
    )
    await waitForSuggestions(container)
    mockedAuthFetch.mockResolvedValue(
      makeResponse([{ path: 'README.md', name: 'README.md', type: 'file', score: 1 }]),
    )
    rerender(<AtMentionAutocomplete text="@READM" cursorPos={6} onSelect={vi.fn()} />)
    await waitFor(() => {
      expect(mockedAuthFetch).toHaveBeenCalledWith('/api/files?q=READM')
    })
  })
})
