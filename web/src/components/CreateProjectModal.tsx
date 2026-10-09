import { useState, useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'wouter'
import { projectsResource } from '../lib/resources'
import { useConfig } from '../hooks/useConfig'
import { useT } from '../hooks/useT'
import { Modal } from './shared/SelfContainedModal'
import { Button } from './shared/Button'
import { Input } from './shared/Input'
import { authFetch } from '../lib/api'
import { shouldAutofocus } from '../lib/device'
import { validateProjectName } from './shared/validation'
import { joinPath } from '../lib/path'
import { DirectoryBrowser } from './shared/DirectoryBrowser'
import { PlusMdIcon } from './shared/icons'
import { PermissionDeniedModal } from './PermissionDeniedModal'

interface CreateProjectModalProps {
  isOpen: boolean
  onClose: () => void
}

export function CreateProjectModal({ isOpen, onClose }: CreateProjectModalProps) {
  const t = useT()
  const [, navigate] = useLocation()
  const { config } = useConfig()
  const [projectName, setProjectName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [baseWorkdir, setBaseWorkdir] = useState<string>('')
  const [showBrowser, setShowBrowser] = useState(false)
  const [permissionDeniedPath, setPermissionDeniedPath] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Fetch workdir from config when modal opens
  useEffect(() => {
    if (isOpen) {
      if (config?.workdir) {
        setBaseWorkdir(config.workdir)
      }
      setProjectName('')
      setError(null)
      setLoading(false)
      setShowBrowser(false)
      setPermissionDeniedPath(null)
      // Focus the input after modal renders
      setTimeout(() => {
        if (shouldAutofocus()) inputRef.current?.focus()
      }, 100)
    }
  }, [isOpen, config?.workdir])

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()

      // Validate project name
      const validation = validateProjectName(projectName)
      if (!validation.valid) {
        setError(validation.error)
        return
      }

      const fullPath = joinPath(baseWorkdir, projectName)
      await createProjectWithPermissionHandling(fullPath)
    },
    [projectName, navigate, onClose, baseWorkdir],
  )

  const handlePermissionDeniedClose = useCallback(() => {
    setPermissionDeniedPath(null)
  }, [])

  const handleRetry = useCallback(async () => {
    const fullPath = joinPath(baseWorkdir, projectName)
    await createProjectWithPermissionHandling(fullPath)
  }, [baseWorkdir, projectName, navigate, onClose, setPermissionDeniedPath, setError, setLoading])

  async function createProjectWithPermissionHandling(fullPath: string) {
    setLoading(true)
    setError(null)
    setPermissionDeniedPath(null)

    try {
      const response = await authFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projectName, workdir: fullPath }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        if (errorData.code === 'EACCES') {
          setPermissionDeniedPath(fullPath)
          setLoading(false)
          return
        }
        throw new Error(errorData.error || t({ en: 'Failed to create project', fr: 'Échec de la création du projet' }))
      }

      const data = await response.json()
      const project = data.project

      onClose()
      await projectsResource.refresh()
      navigate(`/p/${project.id}`)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t({ en: 'Failed to create project', fr: 'Échec de la création du projet' }),
      )
      setLoading(false)
    }
  }

  const handleCancel = useCallback(() => {
    setProjectName('')
    setError(null)
    onClose()
  }, [onClose])

  const fullPath = projectName ? joinPath(baseWorkdir, projectName) : ''

  const handleBaseFolderSelect = useCallback((path: string) => {
    setBaseWorkdir(path)
    setShowBrowser(false)
  }, [])

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleCancel}
        title={t({ en: 'Create New Project', fr: 'Créer un nouveau projet' })}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={handleCancel} disabled={loading}>
              {t({ en: 'Cancel', fr: 'Annuler' })}
            </Button>
            <Button
              type="submit"
              form="create-project-form"
              variant="primary"
              disabled={loading || !projectName.trim()}
              data-testid="create-project-submit-button"
              className="min-w-[100px]"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <PlusMdIcon className="h-4 w-4" />
                  {t({ en: 'Creating...', fr: 'Création…' })}
                </span>
              ) : (
                t({ en: 'Create', fr: 'Créer' })
              )}
            </Button>
          </div>
        }
      >
        <form id="create-project-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="project-name" className="block text-sm font-medium text-text-secondary mb-2">
              {t({ en: 'Project Name', fr: 'Nom du projet' })}
            </label>
            <Input
              ref={inputRef}
              id="project-name"
              value={projectName}
              onChange={(e) => {
                setProjectName(e.target.value)
                setError(null)
              }}
              placeholder={t({ en: 'my-project', fr: 'mon-projet' })}
              disabled={loading}
              data-testid="create-project-name-input"
              className="w-full"
            />
          </div>

          <div>
            <label htmlFor="project-base-folder" className="block text-sm font-medium text-text-secondary mb-2">
              {t({ en: 'Base Folder', fr: 'Dossier de base' })}
            </label>
            <div className="flex items-center gap-2 min-w-0">
              <span
                id="project-base-folder"
                data-testid="create-project-base-folder"
                className="flex-1 truncate font-mono text-sm text-text-secondary"
              >
                {baseWorkdir}
              </span>
              <button
                type="button"
                onClick={() => setShowBrowser(true)}
                aria-label={t({ en: 'Change folder', fr: 'Changer de dossier' })}
                className="shrink-0 px-3 py-2 text-sm rounded-lg border border-border text-text-secondary hover:text-accent-primary"
              >
                {t({ en: 'Folder...', fr: 'Dossier...' })}
              </button>
            </div>
          </div>

          {showBrowser && (
            <DirectoryBrowser
              initialPath={baseWorkdir}
              onSelect={handleBaseFolderSelect}
              onClose={() => setShowBrowser(false)}
            />
          )}

          {/* Path preview */}
          {projectName && (
            <div data-testid="create-project-path-preview" className="text-xs text-text-muted">
              {t({ en: 'Full path:', fr: 'Chemin complet :' })} <span className="font-mono">{fullPath}</span>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="mt-3 p-3 bg-accent-error/10 border border-accent-error/30 rounded text-sm text-accent-error">
              {error}
            </div>
          )}
        </form>
      </Modal>

      {permissionDeniedPath && (
        <PermissionDeniedModal
          isOpen={!!permissionDeniedPath}
          onClose={handlePermissionDeniedClose}
          path={permissionDeniedPath}
          onRetry={handleRetry}
        />
      )}
    </>
  )
}
