import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'wouter'
import { useProjectStore } from '../stores/project'
import { Button } from './shared/Button'
import { Input } from './shared/Input'

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

const DEFAULT_BASE_PATH = '/home/conrad/dev'

interface OpenProjectModalProps {
  isOpen: boolean
  onClose: () => void
}

export function OpenProjectModal({ isOpen, onClose }: OpenProjectModalProps) {
  const [, navigate] = useLocation()
  const [searchQuery, setSearchQuery] = useState('')
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [loading, setLoading] = useState(false)
  
  const projects = useProjectStore(state => state.projects)
  const createProject = useProjectStore(state => state.createProject)
  const listProjects = useProjectStore(state => state.listProjects)
  const [creatingPath, setCreatingPath] = useState<string | null>(null)
  
  // Fetch directory listing
  const fetchDirectory = useCallback(async (path?: string) => {
    setLoading(true)
    try {
      const url = path 
        ? `/api/directories?path=${encodeURIComponent(path)}`
        : '/api/directories'
      const response = await fetch(url)
      const data = await response.json()
      setListing(data)
    } catch (err) {
      console.error('Failed to load directories:', err)
    } finally {
      setLoading(false)
    }
  }, [])
  
  // Load initial directory when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchDirectory(DEFAULT_BASE_PATH)
      listProjects()
    }
  }, [isOpen, fetchDirectory, listProjects])
  
  // Filter directories based on search query
  const filteredDirectories = listing?.directories.filter(dir => 
    searchQuery === '' || dir.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) ?? []
  
  // Handle clicking a project from recent list - navigate directly
  const handleProjectClick = (projectId: string) => {
    navigate(`/p/${projectId}`)
    onClose()
  }
  
  // Handle clicking a directory from browse - create project
  const handleDirectoryClick = (path: string) => {
    const basename = path.split('/').filter(Boolean).pop() ?? ''
    createProject(basename, path)
    listProjects()
    setCreatingPath(path)
  }
  
  // Navigate to newly created project when it appears in the list
  useEffect(() => {
    if (creatingPath) {
      const newProject = projects.find(p => p.workdir === creatingPath)
      if (newProject) {
        navigate(`/p/${newProject.id}`)
        onClose()
        setCreatingPath(null)
      }
    }
  }, [projects, creatingPath, navigate, onClose])
  
  // Handle navigating into a directory (browse only)
  const handleNavigate = (path: string) => {
    setSearchQuery('')
    fetchDirectory(path)
  }
  
  // Build breadcrumbs from current path
  const getBreadcrumbs = () => {
    if (!listing) return []
    const parts = listing.current.split('/').filter(Boolean)
    const crumbs: { name: string; path: string }[] = []
    let currentPath = ''
    for (const part of parts) {
      currentPath += '/' + part
      crumbs.push({ name: part, path: currentPath })
    }
    return crumbs
  }
  
  const breadcrumbs = getBreadcrumbs()
  
  if (!isOpen) return null
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-bg-secondary border border-border rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Open Project</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* Split View Content */}
        <div className="flex-1 flex overflow-hidden min-h-[400px]">
          {/* Left Panel: Recent Projects */}
          <div className="w-1/2 border-r border-border flex flex-col">
            <div className="p-3 border-b border-border bg-bg-tertiary/30">
              <h3 className="font-medium text-sm text-text-secondary">Recent Projects</h3>
            </div>
            
            <div className="flex-1 overflow-y-auto">
              {projects.length === 0 ? (
                <div className="p-4 text-center text-text-muted text-sm">
                  No recent projects
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {projects.map(project => (
                    <button
                      key={project.id}
                      onClick={() => handleProjectClick(project.id)}
                      className="w-full p-3 flex items-center gap-3 text-left hover:bg-bg-tertiary/50 transition-colors"
                    >
                      <svg className="w-5 h-5 text-accent-primary" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                      </svg>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{project.name}</div>
                        <div className="text-xs text-text-muted truncate">{project.workdir}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          {/* Right Panel: Browse Filesystem */}
          <div className="w-1/2 flex flex-col">
            <div className="p-3 border-b border-border bg-bg-tertiary/30">
              <h3 className="font-medium text-sm text-text-secondary">Browse Projects</h3>
            </div>
            
            {/* Search/filter input */}
            <div className="p-3 border-b border-border">
              <div className="relative">
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Type to filter directories..."
                  className="w-full pl-9"
                />
                <svg 
                  className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
            
            {/* Breadcrumbs */}
            <div className="px-3 py-2 bg-bg-tertiary/30 border-b border-border">
              <div className="flex items-center text-xs overflow-x-auto">
                {breadcrumbs.map((crumb, index) => (
                  <span key={crumb.path} className="flex items-center flex-shrink-0">
                    <span className="text-text-muted">/</span>
                    {index === breadcrumbs.length - 1 ? (
                      <span className="text-accent-primary font-medium px-1">
                        {crumb.name}
                      </span>
                    ) : (
                      <button
                        onClick={() => handleNavigate(crumb.path)}
                        className="text-text-secondary hover:text-accent-primary px-1"
                      >
                        {crumb.name}
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
            
            {/* Directory list */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-8 text-center text-text-muted">
                  <div className="animate-spin w-5 h-5 border-2 border-accent-primary border-t-transparent rounded-full mx-auto" />
                </div>
              ) : filteredDirectories.length === 0 ? (
                <div className="p-8 text-center text-text-muted text-sm">
                  {searchQuery ? 'No matching directories' : 'No subdirectories'}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {/* Parent directory - only show when not filtering */}
                  {!searchQuery && listing?.parent && (
                    <button
                      onClick={() => handleNavigate(listing.parent!)}
                      className="w-full p-3 flex items-center gap-3 hover:bg-bg-tertiary/50 text-left text-text-muted"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
                      </svg>
                      <span>..</span>
                    </button>
                  )}
                  
                  {/* Directories */}
                  {filteredDirectories.map(dir => (
                    <div
                      key={dir.path}
                      className="flex items-center group"
                    >
                      <button
                        onClick={() => handleDirectoryClick(dir.path)}
                        className="flex-1 p-3 flex items-center gap-3 text-left hover:bg-bg-tertiary/50 transition-colors"
                      >
                        <svg className="w-5 h-5 text-accent-primary" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                        </svg>
                        <span className="flex-1">{dir.name}</span>
                      </button>
                      <button
                        onClick={() => handleNavigate(dir.path)}
                        className="p-3 text-text-muted hover:text-accent-primary opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Browse folder"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
          </div>
        </div>
        
        {/* Footer Actions */}
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
