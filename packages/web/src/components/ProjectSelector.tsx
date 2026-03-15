import { useState, useEffect, useRef, useCallback } from 'react'
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

export function ProjectSelector() {
  const [name, setName] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [, navigate] = useLocation()
  const pendingCreate = useRef(false)
  const nameManuallySet = useRef(false)
  
  const projects = useProjectStore(state => state.projects)
  const currentProject = useProjectStore(state => state.currentProject)
  const createProject = useProjectStore(state => state.createProject)
  const deleteProject = useProjectStore(state => state.deleteProject)
  const listProjects = useProjectStore(state => state.listProjects)
  
  // Fetch projects on mount
  useEffect(() => {
    listProjects()
  }, [listProjects])
  
  // Navigate to project when created
  useEffect(() => {
    if (currentProject && pendingCreate.current) {
      pendingCreate.current = false
      navigate(`/p/${currentProject.id}`)
    }
  }, [currentProject, navigate])
  
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
  
  // Load initial directory when showing new project form
  useEffect(() => {
    if (showNew) {
      fetchDirectory(DEFAULT_BASE_PATH)
    }
  }, [showNew, fetchDirectory])
  
  // Filter directories based on search query
  const filteredDirectories = listing?.directories.filter(dir => 
    searchQuery === '' || dir.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) ?? []
  
  // Auto-derive name from selected path
  useEffect(() => {
    if (selectedPath && !nameManuallySet.current) {
      const basename = selectedPath.split('/').filter(Boolean).pop() ?? ''
      setName(basename)
    }
  }, [selectedPath])
  
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    nameManuallySet.current = true
    setName(e.target.value)
  }
  
  const handleCreate = () => {
    if (!selectedPath || !name.trim()) return
    pendingCreate.current = true
    createProject(name, selectedPath)
    handleCancel()
  }
  
  const handleSelectDirectory = (path: string) => {
    setSelectedPath(path)
  }
  
  const handleNavigate = (path: string) => {
    setSelectedPath(null)
    setSearchQuery('')
    fetchDirectory(path)
  }
  
  const handleCancel = () => {
    setShowNew(false)
    setSelectedPath(null)
    setSearchQuery('')
    setName('')
    nameManuallySet.current = false
  }
  
  const handleSelectProject = (projectId: string) => {
    navigate(`/p/${projectId}`)
  }
  
  const handleDeleteProject = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm('Delete this project and all its sessions?')) {
      deleteProject(projectId)
    }
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
  
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-accent-primary mb-2">OpenFox</h1>
          <p className="text-text-secondary">
            Local LLM-powered coding assistant with contract-driven execution
          </p>
        </div>
        
        {showNew ? (
          <div className="bg-bg-secondary border border-border rounded overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-border">
              <h2 className="text-lg font-semibold mb-3">Select Project Directory</h2>
              
              {/* Search/filter input */}
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
            <div className="px-4 py-2 bg-bg-tertiary/30 border-b border-border">
              <div className="flex items-center text-sm overflow-x-auto">
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
            <div className="max-h-72 overflow-y-auto">
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
                  {filteredDirectories.map(dir => {
                    const isSelected = selectedPath === dir.path
                    return (
                      <div
                        key={dir.path}
                        className={`flex items-center group ${isSelected ? 'bg-accent-primary/10' : ''}`}
                      >
                        <button
                          onClick={() => handleSelectDirectory(dir.path)}
                          className={`flex-1 p-3 flex items-center gap-3 text-left hover:bg-bg-tertiary/50 ${
                            isSelected ? 'text-accent-primary' : ''
                          }`}
                        >
                          <svg className={`w-5 h-5 ${isSelected ? 'text-accent-primary' : 'text-accent-primary/70'}`} fill="currentColor" viewBox="0 0 24 24">
                            <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                          </svg>
                          <span className="flex-1">{dir.name}</span>
                          {isSelected && (
                            <svg className="w-5 h-5 text-accent-primary" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={() => handleNavigate(dir.path)}
                          className="p-3 text-text-muted hover:text-accent-primary opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Open folder"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            
            {/* Selected path and name input */}
            {selectedPath && (
              <div className="p-4 border-t border-border bg-bg-tertiary/30 space-y-3">
                <div className="text-sm">
                  <span className="text-text-muted">Selected: </span>
                  <span className="text-accent-primary font-mono">{selectedPath}</span>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={name}
                    onChange={handleNameChange}
                    placeholder="Project name"
                    className="flex-1"
                  />
                </div>
              </div>
            )}
            
            {/* Footer actions */}
            <div className="p-4 border-t border-border flex justify-end gap-2">
              <Button variant="secondary" onClick={handleCancel}>
                Cancel
              </Button>
              <Button 
                variant="primary" 
                onClick={handleCreate} 
                disabled={!selectedPath || !name.trim()}
              >
                Create Project
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Button
              variant="primary"
              className="w-full py-4"
              onClick={() => setShowNew(true)}
            >
              + New Project
            </Button>
            
            {projects.length > 0 && (
              <div className="bg-bg-secondary border border-border rounded overflow-hidden">
                <div className="p-3 border-b border-border">
                  <h2 className="font-semibold text-sm text-text-secondary">
                    Projects
                  </h2>
                </div>
                
                <div className="divide-y divide-border">
                  {projects.map(project => (
                    <div
                      key={project.id}
                      className="p-4 hover:bg-bg-tertiary/50 flex items-center justify-between group cursor-pointer"
                      onClick={() => handleSelectProject(project.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-text-primary">
                          {project.name}
                        </div>
                        <div className="text-sm text-text-muted truncate">
                          {project.workdir}
                        </div>
                      </div>
                      
                      <button
                        onClick={(e) => handleDeleteProject(project.id, e)}
                        className="opacity-0 group-hover:opacity-100 text-accent-error/70 hover:text-accent-error p-2 transition-opacity"
                        title="Delete project"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
