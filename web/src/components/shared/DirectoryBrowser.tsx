import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '../../lib/api'
import { Spinner } from './Spinner'

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

  const fetchDirectory = useCallback(async (path?: string) => {
    setLoading(true)
    try {
      const url = path
        ? `/api/directories?path=${encodeURIComponent(path)}`
        : '/api/directories'
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
    fetchDirectory(initialPath)
  }, [initialPath, fetchDirectory])

  const handleNavigate = (path: string) => {
    fetchDirectory(path)
  }

  const handleSelect = (path: string) => {
    onSelect(path)
  }

  const currentPath = listing?.current ?? ''
  const pathParts = currentPath.split('/').filter(Boolean)
  const crumbs = pathParts.map((part, i) => ({
    name: part,
    path: '/' + pathParts.slice(0, i + 1).join('/'),
  }))
  
  const breadcrumbs = crumbs

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-bg-secondary border border-border rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Select Folder</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {listing && (
          <div className="px-3 py-2 bg-bg-tertiary/30 border-b border-border">
            <div className="flex items-center text-xs overflow-x-auto">
              {breadcrumbs.map((crumb, index) => (
                <span key={crumb.path} className="flex items-center shrink-0">
                  <span className="text-text-muted">/</span>
                  <button
                    onClick={() => handleNavigate(crumb.path)}
                    className={`px-1 ${index === breadcrumbs.length - 1 ? 'text-accent-primary font-medium' : 'text-text-secondary hover:text-accent-primary'}`}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
              {breadcrumbs.length === 0 && (
                <button onClick={() => handleNavigate('/')} className="text-text-muted hover:text-accent-primary">/</button>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center">
              <Spinner size="sm" />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {listing?.parent && (
                <button onClick={() => handleNavigate(listing.parent!)} className="w-full p-3 flex items-center gap-3 hover:bg-bg-tertiary/50 text-text-muted">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  <span>..</span>
                </button>
              )}
              {listing?.directories.map(dir => (
                <div key={dir.path} className="group flex items-center gap-2 hover:bg-bg-tertiary/50">
                  <button
                    onClick={() => handleNavigate(dir.path)}
                    className="flex-1 p-3 flex items-center gap-3 text-left"
                  >
                    <svg className="w-5 h-5 text-accent-primary" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                    </svg>
                    <span>{dir.name}</span>
                  </button>
                  <button
                    onClick={() => handleSelect(dir.path)}
                    className="px-3 py-1 text-xs bg-accent-primary/10 text-accent-primary rounded opacity-0 group-hover:opacity-100 transition-opacity mr-3"
                  >
                    Select
                  </button>
                </div>
              ))}
              {listing?.directories.length === 0 && (
                <div className="p-8 text-center text-text-muted text-sm">
                  No subdirectories
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border space-y-2">
          {listing?.current && (
            <button
              onClick={() => handleSelect(listing.current)}
              className="w-full px-4 py-2 bg-accent-primary text-white rounded-lg font-medium hover:bg-accent-primary/90 transition-colors"
            >
              Select this folder
            </button>
          )}
          <button onClick={onClose} className="w-full text-center text-text-muted hover:text-text-secondary text-sm">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}