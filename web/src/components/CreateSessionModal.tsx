import { useState, useEffect } from 'react'
import { useLocation } from 'wouter'
import { useProjectStore } from '../stores/project'
import { Modal } from './shared/Modal'
import { Button } from './shared/Button'
import { FolderIcon, TrashIcon } from './shared/icons'
import { authFetch } from '../lib/api'
import { DeleteProjectConfirmationModal } from './DeleteProjectConfirmationModal.js'
import { CreateProjectModal } from './CreateProjectModal.js'
import { DirectoryBrowser } from './shared/DirectoryBrowser.js'
import { PermissionDeniedModal } from './PermissionDeniedModal.js'

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
  const [permissionDeniedPath, setPermissionDeniedPath] = useState<string | null>(null)

  const truncateMiddle = (path: string, maxLen = 32) => {
    if (path.length <= maxLen) return path
    const parts = path.split('/').filter(Boolean)
    if (parts.length <= 2) return path
    const first = parts[0]!
    const last = parts[parts.length - 1]!
    const middle = parts.slice(1, -1).join('/')
    const space = maxLen - first.length - last.length - 3
    if (space < 0) return path
    const lchars = middle.slice(0, Math.floor(space / 2))
    const rchars = middle.slice(-Math.ceil(space / 2))
    return `/${first}/${lchars}...${rchars}/${last}`
  }

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

  const handleDirectorySelect = async (path: string) => {
    const basename = path.split('/').filter(Boolean).pop() ?? ''
    const result = await createProject(basename, path)
    listProjects()
    setCreatingPath(path)
    if (result && typeof result === 'object' && 'error' in result && result.error && typeof result.error === 'object' && 'code' in result.error && result.error.code === 'EACCES') {
      setPermissionDeniedPath((result.error as { path?: string }).path || path)
    }
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
      <div className="flex flex-col sm:flex-row flex-1 -m-4">
        <div className="w-full sm:w-1/2 border-b sm:border-b-0 sm:border-r border-border flex flex-col max-h-[40vh] sm:max-h-[50vh]">
          <div className="p-3 border-b border-border bg-bg-tertiary/30 shrink-0">
            <h3 className="font-medium text-sm text-text-secondary">Recent Projects</h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            {projects.length === 0 ? (
              <div className="p-6 text-center text-text-muted text-sm">
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
                        <div className="text-xs text-text-muted truncate">{truncateMiddle(project.workdir)}</div>
                      </div>
                    </button>
                    <button
                      onClick={(e) => handleDeleteClick(project, e)}
                      className="text-accent-error/70 hover:text-accent-error p-1"
                      title="Delete project"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="w-full sm:w-1/2 flex flex-col items-center justify-center p-6 sm:p-8 text-center">
          <div className="flex flex-col gap-3 w-full max-w-sm">
            <Button variant="primary" onClick={() => setShowBrowser(true)}>
              Select existing project
            </Button>
            <Button variant="secondary" onClick={() => setShowCreateModal(true)} data-testid="open-project-create-button">
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
      {permissionDeniedPath && (
        <PermissionDeniedModal
          isOpen={true}
          onClose={() => setPermissionDeniedPath(null)}
          path={permissionDeniedPath}
          onRetry={() => {
            setPermissionDeniedPath(null)
            handleDirectorySelect(permissionDeniedPath)
          }}
        />
      )}
    </Modal>
  )
}