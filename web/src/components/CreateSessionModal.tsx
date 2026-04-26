import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation } from 'wouter'
import { useProjectStore } from '../stores/project'
import { Modal } from './shared/Modal'
import { Button } from './shared/Button'
import { Input } from './shared/Input'
import { DeleteProjectConfirmationModal } from './DeleteProjectConfirmationModal.js'
import { CreateProjectModal } from './CreateProjectModal.js'
import { DirectoryBrowser } from './shared/DirectoryBrowser.js'
import { fetchDirectory } from '../lib/useDirectoryFetch'
import { FolderIcon, CopyIcon } from './shared/icons'
import { authFetch } from '../lib/api'

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

interface OpenProjectModalProps {
  isOpen: boolean
  onClose: () => void
}

export function OpenProjectModal({ isOpen, onClose }: OpenProjectModalProps) {
  const [, navigate] = useLocation()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [baseWorkdir, setBaseWorkdir] = useState<string | null>(null)
  
  const projects = useProjectStore(state => state.projects)
  const createProject = useProjectStore(state => state.createProject)
  const listProjects = useProjectStore(state => state.listProjects)
  const deleteProject = useProjectStore(state => state.deleteProject)
  const [creatingPath, setCreatingPath] = useState<string | null>(null)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; name: string } | null>(null)
  const [showBrowser, setShowBrowser] = useState(false)
  const itemsRef = useRef<HTMLButtonElement[]>([])
  
  useEffect(() => {
    authFetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data.workdir) setBaseWorkdir(data.workdir)
      })
  }, [])
  
  const loadDirectory = useCallback(async (path?: string) => {
    setLoading(true)
    try {
      const data = await fetchDirectory(path, baseWorkdir ?? undefined)
      setListing(data)
    } catch (err) {
      console.error('Failed to load directories:', err)
    } finally {
      setLoading(false)
    }
  }, [baseWorkdir])
  
  useEffect(() => {
    if (isOpen && baseWorkdir) {
      fetchDirectory(baseWorkdir)
      listProjects()
    }
  }, [isOpen, baseWorkdir, loadDirectory, listProjects])
  
  const filteredDirectories = listing?.directories.filter(dir => 
    searchQuery === '' || dir.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) ?? []
  
  const visibleItems = [
    ...(listing?.parent && !searchQuery ? [{ type: 'parent' as const, path: listing.parent, name: '..' }] : []),
    ...filteredDirectories.map(dir => ({ type: 'directory' as const, path: dir.path, name: dir.name }))
  ]
  
  const handleProjectClick = (projectId: string) => {
    navigate(`/p/${projectId}`)
    onClose()
  }
  
  const handleDeleteClick = (project: { id: string; name: string }, e: React.MouseEvent) => {
    e.stopPropagation()
    setProjectToDelete(project)
  }
  
  const handleConfirmDelete = () => {
    if (projectToDelete) {
      deleteProject(projectToDelete.id)
      setProjectToDelete(null)
    }
  }
  
  const handleDirectoryClick = (path: string) => {
    const basename = path.split('/').filter(Boolean).pop() ?? ''
    createProject(basename, path)
    listProjects()
    setCreatingPath(path)
  }
  
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
  
  useEffect(() => {
    setFocusedIndex(visibleItems.length > 0 ? 0 : -1)
  }, [searchQuery, visibleItems.length])
  
  const handleNavigate = (path: string) => {
    setSearchQuery('')
    fetchDirectory(path)
  }
  
  useEffect(() => {
    if (focusedIndex >= 0 && itemsRef.current[focusedIndex]) {
      itemsRef.current[focusedIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [focusedIndex])
  
  if (!isOpen) return null
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Open Project" size="xl" footer={
      <div className="flex justify-between gap-2">
        <Button variant="secondary" onClick={() => setShowCreateModal(true)} data-testid="open-project-create-button">
          Create Project
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    }>
      <div className="flex flex-1 -m-4">
        {/* Recent Projects */}
        <div className="w-1/2 border-r border-border flex flex-col">
          <div className="p-3 border-b border-border bg-bg-tertiary/30">
            <h3 className="font-medium text-sm text-text-secondary">Recent Projects</h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            {projects.length === 0 ? (
              <div className="p-4 text-center text-text-muted text-sm">No recent projects</div>
            ) : (
              <div className="divide-y divide-border">
                {projects.map(project => (
                  <div key={project.id} className="group flex items-center gap-3 p-3 hover:bg-bg-tertiary/50 transition-colors">
                    <button
                      onClick={() => handleProjectClick(project.id)}
                      className="flex-1 flex items-center gap-3 text-left"
                    >
                      <FolderIcon className="w-5 h-5 text-accent-primary" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{project.name}</div>
                        <div className="text-xs text-text-muted truncate">{project.workdir}</div>
                      </div>
                    </button>
                    <button
                      onClick={(e) => handleDeleteClick(project, e)}
                      className="opacity-0 group-hover:opacity-100 text-accent-error/70 hover:text-accent-error p-1 transition-opacity"
                      title="Delete project"
                    >
                      <CopyIcon className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        
        {/* Browse Filesystem */}
        <div className="w-1/2 flex flex-col">
          <div className="p-3 border-b border-border bg-bg-tertiary/30 flex items-center justify-between">
            <h3 className="font-medium text-sm text-text-secondary">Browse Projects</h3>
            <button onClick={() => setShowBrowser(true)} className="text-xs text-accent-primary hover:underline">
              Open in dialog
            </button>
          </div>
          <div className="p-3 border-b border-border">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter directories..."
              className="w-full"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-text-muted">
                <div className="animate-spin w-5 h-5 border-2 border-accent-primary border-t-transparent rounded-full mx-auto" />
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="p-8 text-center text-text-muted text-sm">
                {searchQuery ? 'No matching directories' : 'No subdirectories'}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {visibleItems.map((item, index) => (
                  <button
                    ref={el => { if (el) itemsRef.current[index] = el }}
                    key={item.path}
                    onClick={() => item.type === 'parent' ? handleNavigate(item.path) : handleDirectoryClick(item.path)}
                    className={`w-full p-3 flex items-center gap-3 text-left transition-colors ${
                      index === focusedIndex ? 'bg-accent-primary/20 text-accent-primary' : 'hover:bg-bg-tertiary/50'
                    }`}
                  >
                    <FolderIcon className="w-5 h-5" />
                    <span className="flex-1">{item.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <CreateProjectModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />
      )}
      {projectToDelete && (
        <DeleteProjectConfirmationModal
          isOpen={true}
          onClose={() => setProjectToDelete(null)}
          projectName={projectToDelete.name}
          onConfirm={handleConfirmDelete}
        />
      )}
      {showBrowser && (
        <DirectoryBrowser
          initialPath={baseWorkdir ?? undefined}
          onSelect={(path) => { handleDirectoryClick(path); setShowBrowser(false) }}
          onClose={() => setShowBrowser(false)}
        />
      )}
    </Modal>
  )
}