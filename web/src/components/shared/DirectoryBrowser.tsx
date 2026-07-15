import { useState, useEffect, useCallback, useRef } from 'react'
import { Modal } from './Modal'
import { ArrowLeftIcon, ArrowRightIcon, FolderIcon, SearchIcon } from './icons'
import { Spinner } from './Spinner'
import { authFetch } from '../../lib/api'
import { Input } from './Input'

interface DirectoryEntry {
  name: string
  path: string
}

interface DirectoryListing {
  current: string
  parent: string | null
  directories: DirectoryEntry[]
  basename: string
}

interface DirectoryBrowserProps {
  onSelect: (path: string) => void
  onClose: () => void
  initialPath?: string
}

export function DirectoryBrowser({ onSelect, onClose, initialPath }: DirectoryBrowserProps) {
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([])

  const fetchDir = useCallback(async (path?: string) => {
    setLoading(true)
    setSearchQuery('')
    setFocusedIndex(-1)
    try {
      const url = path ? `/api/directories?path=${encodeURIComponent(path)}` : '/api/directories'
      const response = await authFetch(url)
      const data = await response.json()
      setListing(data)
    } catch (err) {
      console.error('Failed to load directories:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDir(initialPath)
  }, [initialPath, fetchDir])

  const crumbs = (listing?.current ?? '')
    .split('/')
    .filter(Boolean)
    .map((part, i, arr) => ({
      name: part,
      path: '/' + arr.slice(0, i + 1).join('/'),
    }))

  const filteredDirs =
    listing?.directories.filter(
      (dir) => searchQuery === '' || dir.name.toLowerCase().includes(searchQuery.toLowerCase()),
    ) ?? []

  const visibleItems = [
    ...(listing?.parent ? [{ type: 'parent' as const, path: listing.parent, name: '..' }] : []),
    ...filteredDirs.map((dir) => ({ type: 'dir' as const, path: dir.path, name: dir.name })),
  ]

  useEffect(() => {
    setFocusedIndex(searchQuery ? 0 : -1)
  }, [searchQuery, filteredDirs.length])

  useEffect(() => {
    if (focusedIndex >= 0 && itemsRef.current[focusedIndex]) {
      itemsRef.current[focusedIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [focusedIndex])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex((i) => Math.min(i + 1, visibleItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (focusedIndex >= 0 && visibleItems[focusedIndex]) {
        const item = visibleItems[focusedIndex]
        fetchDir(item.path)
      }
    } else if (e.key === 'Escape') {
      setSearchQuery('')
      inputRef.current?.focus()
    }
  }

  const footer = (
    <div className="flex flex-col gap-2">
      {listing?.current && (
        <button
          onClick={() => onSelect(listing.current)}
          className="w-full px-4 py-2 bg-accent-primary text-text-primary rounded-lg font-medium hover:bg-accent-primary/90 transition-colors"
        >
          Select this folder
        </button>
      )}
      <button onClick={onClose} className="w-full text-center text-text-muted hover:text-text-secondary text-sm">
        Cancel
      </button>
    </div>
  )

  return (
    <Modal isOpen={true} onClose={onClose} title="Select Folder" size="lg" footer={footer}>
      <div className="flex flex-col h-full -m-4">
        <div className="sticky top-0 bg-bg-secondary z-10 border-b border-border">
          {listing && (
            <div className="px-3 py-2 bg-bg-tertiary/30">
              <div className="flex items-center text-xs overflow-x-auto">
                {crumbs.map((crumb, index) => (
                  <span key={crumb.path} className="flex items-center shrink-0">
                    <span className="text-text-muted">/</span>
                    <button
                      onClick={() => fetchDir(crumb.path)}
                      className={`px-1 ${index === crumbs.length - 1 ? 'text-accent-primary font-medium' : 'text-text-secondary hover:text-accent-primary'}`}
                    >
                      {crumb.name}
                    </button>
                  </span>
                ))}
                {crumbs.length === 0 && (
                  <button onClick={() => fetchDir('/')} className="text-text-muted hover:text-accent-primary">
                    /
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="px-4 py-3">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none flex items-center justify-center">
                <SearchIcon />
              </span>
              <Input
                autoFocus
                ref={inputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Filter directories..."
                className="w-full pl-9"
              />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center">
              <Spinner size="sm" />
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="p-8 text-center text-text-muted text-sm">
              {searchQuery ? 'No matching directories' : 'No subdirectories'}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {visibleItems.map((item, index) => (
                <div
                  key={item.path}
                  className={`group flex items-center transition-colors ${
                    index === focusedIndex ? 'bg-accent-primary/20' : 'hover:bg-bg-tertiary/50'
                  }`}
                >
                  <button
                    ref={(el) => {
                      itemsRef.current[index] = el
                    }}
                    onClick={() => {
                      fetchDir(item.path)
                    }}
                    className="flex-1 flex items-center gap-3 p-3 text-left min-w-0"
                  >
                    {item.type === 'parent' ? (
                      <ArrowLeftIcon className="w-5 h-5 text-text-muted shrink-0" />
                    ) : (
                      <FolderIcon className="w-5 h-5 shrink-0" />
                    )}
                    <span className="truncate">{item.name}</span>
                  </button>
                  {item.type === 'dir' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        fetchDir(item.path)
                      }}
                      className="mr-2 p-2 text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity rounded hover:bg-bg-tertiary"
                      title="Navigate into folder"
                    >
                      <ArrowRightIcon className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
