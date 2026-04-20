import { useState, useEffect, useCallback } from 'react'
import { Modal } from './Modal'
import { Spinner } from './Spinner'
import { authFetch } from '../../lib/api'

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

  const fetchDir = useCallback(async (path?: string) => {
    setLoading(true)
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

  const crumbs = (listing?.current ?? '').split('/').filter(Boolean).map((part, i, arr) => ({
    name: part,
    path: '/' + arr.slice(0, i + 1).join('/'),
  }))

  return (
    <Modal isOpen={true} onClose={onClose} title="Select Folder" size="lg">
      {listing && (
        <div className="px-3 py-2 bg-bg-tertiary/30 -mx-4 -mt-4 mb-4 border-b border-border">
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
              <button onClick={() => fetchDir('/')} className="text-text-muted hover:text-accent-primary">/</button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto -mx-4">
        {loading ? (
          <div className="p-8 text-center"><Spinner size="sm" /></div>
        ) : (
          <div className="divide-y divide-border">
            {listing?.parent && (
              <button onClick={() => fetchDir(listing.parent!)} className="w-full p-3 flex items-center gap-3 hover:bg-bg-tertiary/50 text-text-muted">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span>..</span>
              </button>
            )}
            {listing?.directories.map(dir => (
              <div key={dir.path} className="group flex items-center gap-2 hover:bg-bg-tertiary/50">
                <button
                  onClick={() => fetchDir(dir.path)}
                  className="flex-1 p-3 flex items-center gap-3 text-left"
                >
                  <svg className="w-5 h-5 text-accent-primary" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                  </svg>
                  <span>{dir.name}</span>
                </button>
                <button
                  onClick={() => onSelect(dir.path)}
                  className="px-3 py-1 text-xs bg-accent-primary/10 text-accent-primary rounded opacity-0 group-hover:opacity-100 transition-opacity mr-3"
                >
                  Select
                </button>
              </div>
            ))}
            {listing?.directories.length === 0 && (
              <div className="p-8 text-center text-text-muted text-sm">No subdirectories</div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 pt-4 border-t border-border mt-4 -mx-4 -mb-4 p-4">
        {listing?.current && (
          <button
            onClick={() => onSelect(listing.current)}
            className="w-full px-4 py-2 bg-accent-primary text-white rounded-lg font-medium hover:bg-accent-primary/90 transition-colors"
          >
            Select this folder
          </button>
        )}
        <button onClick={onClose} className="w-full text-center text-text-muted hover:text-text-secondary text-sm">
          Cancel
        </button>
      </div>
    </Modal>
  )
}