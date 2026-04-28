import { useState, useEffect } from 'react'
import { useLocation } from 'wouter'
import { useProjectStore } from '../stores/project'
import { Modal } from './shared/Modal'
import { Button } from './shared/Button'
import { FolderIcon, CopyIcon } from './shared/icons'
import { authFetch } from '../lib/api'
import { DeleteProjectConfirmationModal } from './DeleteProjectConfirmationModal.js'
import { CreateProjectModal } from './CreateProjectModal.js'
import { DirectoryBrowser } from './shared/DirectoryBrowser.js'

interface OpenProjectModalProps {
  isOpen: boolean
  onClose: () => void
}

export function OpenProjectModal({ isOpen, onClose }: OpenProjectModalProps) {
  const [, navigate] = useLocation()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [baseWorkdir, setBaseWorkdir] = useState<string | null>(null)
  const [showBrowser, setShowBrowser] = useState(false)

  const projects = useProjectStore(state => state.projects)
  const createProject = useProjectStore(state => state.createProject)
  const listProjects = useProjectStore(state => state.listProjects)
  const deleteProject = useProjectStore(state => state.deleteProject)
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; name: string } | null>(null)
  const [creatingPath, setCreatingPath] = useState<string | null>(null)

  useEffect(() => {
    authFetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data.workdir) setBaseWorkdir(data.workdir)
      })
  }, [])

  useEffect(() => {
    if (isOpen) {
      listProjects()
    }
  }, [isOpen, listProjects])

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

  const handleDirectorySelect = (path: string) => {
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

  if (!isOpen) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Open Project" size="xl" footer={
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    }>
      <div className="flex flex-1 -m-4">
        <div className="w-1/2 border-r border-border flex flex-col">
          <div className="p-3 border-b border-border bg-bg-tertiary/30">
            <h3 className="font-medium text-sm text-text-secondary">Recent Projects</h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            {projects.length === 0 ? (
              <div className="p-8 text-center text-text-muted text-sm">
                <p className="mb-2">No recent projects</p>
                <p className="text-xs">Click "Create new project" to add one</p>
              </div>
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

        <div className="w-1/2 flex flex-col items-center justify-center p-8 text-center">
          <div className="flex flex-col gap-3 w-full max-w-xs">
            <Button variant="primary" onClick={() => setShowBrowser(true)}>
              Select existing project
            </Button>
            <Button variant="secondary" onClick={() => setShowCreateModal(true)}>
              Create new project
            </Button>
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
          onSelect={(path) => { handleDirectorySelect(path); setShowBrowser(false) }}
          onClose={() => setShowBrowser(false)}
        />
      )}
    </Modal>
  )
}