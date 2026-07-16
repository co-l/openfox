import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'wouter'
import { useProjectStore } from '../stores/project'
import { Modal } from './shared/Modal'
import { Button } from './shared/Button'
import { FolderIcon, TrashIcon } from './shared/icons'
import { truncateMiddle, pathBasename } from '../lib/path'
import { DeleteProjectConfirmationModal } from './DeleteProjectConfirmationModal.js'
import { CreateProjectModal } from './CreateProjectModal.js'
import { DirectoryBrowser } from './shared/DirectoryBrowser.js'
import { PermissionDeniedModal } from './PermissionDeniedModal.js'
import { useWorkdir } from '../hooks/useWorkdir.js'

interface OpenProjectModalProps {
  isOpen: boolean
  onClose: () => void
}

export function OpenProjectModal({ isOpen, onClose }: OpenProjectModalProps) {
  const [, navigate] = useLocation()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const baseWorkdir = useWorkdir()
  const [showBrowser, setShowBrowser] = useState(false)

  const projects = useProjectStore((state) => state.projects)
  const createProject = useProjectStore((state) => state.createProject)
  const listProjects = useProjectStore((state) => state.listProjects)
  const deleteProject = useProjectStore((state) => state.deleteProject)
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; name: string } | null>(null)
  const [permissionDeniedPath, setPermissionDeniedPath] = useState<string | null>(null)

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

  const handleDirectorySelect = async (path: string): Promise<boolean> => {
    return handleProjectCreation(path)
  }

  function isPermissionDenied(result: unknown): result is { error: { code: string; path?: string } } {
    return (
      result != null &&
      typeof result === 'object' &&
      'error' in result &&
      result.error != null &&
      typeof result.error === 'object' &&
      'code' in result.error &&
      result.error.code === 'EACCES'
    )
  }

  async function handleProjectCreation(path: string): Promise<boolean> {
    const basename = pathBasename(path)
    const result = await createProject(basename, path)
    listProjects()
    if (isPermissionDenied(result)) {
      setPermissionDeniedPath((result.error as { path?: string }).path || path)
      return false
    }
    if (result && 'id' in result) {
      navigate(`/p/${result.id}`)
      onClose()
      return true
    }
    return false
  }

  const handlePermissionDeniedClose = useCallback(() => {
    setPermissionDeniedPath(null)
  }, [])

  const handleRetry = useCallback(async () => {
    const path = permissionDeniedPath
    setPermissionDeniedPath(null)
    if (path) {
      await handleProjectCreation(path)
    }
  }, [permissionDeniedPath])

  if (!isOpen) return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Open Project"
      size="xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
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
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="group flex items-center gap-3 p-3 hover:bg-bg-tertiary/50 transition-colors"
                  >
                    <button
                      onClick={() => handleProjectClick(project.id)}
                      className="flex-1 flex items-center gap-3 text-left"
                    >
                      <FolderIcon className="w-5 h-5 text-accent-primary" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{project.name}</div>
                        <div className="text-xs text-text-muted truncate">{truncateMiddle(project.workdir, 32)}</div>
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
            <Button
              variant="secondary"
              onClick={() => setShowCreateModal(true)}
              data-testid="open-project-create-button"
            >
              Create new project
            </Button>
          </div>
        </div>
      </div>

      {showCreateModal && <CreateProjectModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />}
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
          onSelect={(path) => {
            handleDirectorySelect(path)
          }}
          onClose={() => setShowBrowser(false)}
        />
      )}
      {permissionDeniedPath && (
        <PermissionDeniedModal
          isOpen={true}
          onClose={handlePermissionDeniedClose}
          path={permissionDeniedPath}
          onRetry={handleRetry}
        />
      )}
    </Modal>
  )
}
