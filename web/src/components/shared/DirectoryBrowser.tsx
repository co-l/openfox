import { useState, useEffect, useCallback, useRef } from 'react'
import { Modal } from './Modal'
import { ArrowLeftIcon, ChevronDownIcon, FolderIcon, SearchIcon } from './icons'
import { Spinner } from './Spinner'
import { authFetch } from '../../lib/api'
import { pathBreadcrumbs } from '../../lib/path'
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
  const containerRef = useRef<HTMLDivElement>(null)

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

  const crumbs = pathBreadcrumbs(listing?.current ?? '')

  const filteredDirs =
    listing?.directories.filter(
      (dir) => searchQuery === '' || dir.name.toLowerCase().includes(searchQuery.toLowerCase()),
    ) ?? []

  const visibleItems = [
    ...(!searchQuery && listing?.parent ? [{ type: 'parent' as const, path: listing.parent, name: '..' }] : []),
    ...filteredDirs.map((dir) => ({ type: 'dir' as const, path: dir.path, name: dir.name })),
  ]

  useEffect(() => {
    setFocusedIndex(searchQuery ? 0 : -1)
  }, [searchQuery, filteredDirs.length])

  useEffect(() => {
    if (focusedIndex >= 0 && containerRef.current) {
      const row = containerRef.current.querySelector(`[data-index="${focusedIndex}"]`)
      row?.scrollIntoView({ block: 'nearest' })
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
      if (focusedIndex < 0 || !visibleItems[focusedIndex]) return
      if (e.target instanceof HTMLElement && e.target.dataset.select === 'true') return
      e.preventDefault()
      if (e.shiftKey) {
        fetchDir(visibleItems[focusedIndex].path)
      } else {
        onSelect(visibleItems[focusedIndex].path)
      }
    } else if (e.key === 'Escape') {
      setSearchQuery('')
      inputRef.current?.focus()
    }
  }

  const footer = (
    <div className="flex flex-col gap-2">
      <button onClick={onClose} className="w-full text-center text-text-muted hover:text-text-secondary text-sm">
        Cancel
      </button>
    </div>
  )

  return (
    <Modal isOpen={true} onClose={onClose} title="Select Folder" size="lg" footer={footer} scrollable={false}>
      <div ref={containerRef} className="flex flex-col flex-1 min-h-0 -m-4" onKeyDown={handleKeyDown}>
        <div className="flex-shrink-0 bg-bg-secondary border-b border-border">
          {listing && (
            <div className="px-3 pt-3 pb-1">
              <div className="flex items-center gap-2 text-sm">
                <div className="flex items-center flex-wrap min-w-0">
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
                {listing?.current && (
                  <button
                    onClick={() => onSelect(listing.current)}
                    className="ml-auto shrink-0 px-4 py-2 text-sm font-medium rounded-lg bg-accent-primary text-text-primary hover:bg-accent-primary/90"
                  >
                    Select
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="px-4 py-2">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none flex items-center justify-center">
                <SearchIcon />
              </span>
              <Input
                autoFocus
                ref={inputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
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
                  data-index={index}
                  className={`group flex items-center ${
                    index === focusedIndex ? 'bg-accent-primary/20' : 'hover:bg-bg-tertiary/50'
                  }`}
                >
                  <button
                    onClick={() => {
                      fetchDir(item.path)
                    }}
                    className="flex-1 flex items-center gap-3 p-3 text-left min-w-0"
                    tabIndex={-1}
                  >
                    {item.type === 'parent' ? (
                      <ArrowLeftIcon className="w-5 h-5 text-text-muted shrink-0" />
                    ) : (
                      <FolderIcon className="w-5 h-5 shrink-0" />
                    )}
                    <span className="truncate">{item.name}</span>
                    {item.type === 'dir' && (
                      <ChevronDownIcon
                        className={`w-5 h-5 text-text-muted shrink-0 ml-1 ${
                          index === focusedIndex ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}
                        rotate={-90}
                      />
                    )}
                  </button>
                  {item.type === 'dir' && (
                    <button
                      data-select="true"
                      tabIndex={index === focusedIndex ? 0 : -1}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelect(item.path)
                      }}
                      className={`mr-2 shrink-0 px-4 py-2 text-sm font-medium rounded-lg bg-accent-primary text-text-primary hover:bg-accent-primary/90 ${
                        index === focusedIndex ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                      aria-label={`Select ${item.name}`}
                    >
                      Select
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
