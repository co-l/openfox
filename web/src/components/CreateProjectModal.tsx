import { useState, useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'wouter'
import { Modal } from './shared/SelfContainedModal'
import { Button } from './shared/Button'
import { Input } from './shared/Input'
import { authFetch } from '../lib/api'
import { validateProjectName } from './shared/validation'
import { PlusMdIcon } from './shared/icons'

interface CreateProjectModalProps {
  isOpen: boolean
  onClose: () => void
}

export function CreateProjectModal({ isOpen, onClose }: CreateProjectModalProps) {
  const [, navigate] = useLocation()
  const [projectName, setProjectName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [workdir, setWorkdir] = useState<string>('')
  const inputRef = useRef<HTMLInputElement>(null)
  
  // Fetch workdir from config when modal opens
  useEffect(() => {
    if (isOpen) {
      authFetch('/api/config')
        .then(res => res.json())
        .then(data => {
          if (data.workdir) {
            setWorkdir(data.workdir)
          }
        })
      setProjectName('')
      setError(null)
      setLoading(false)
      // Focus the input after modal renders
      setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
    }
  }, [isOpen])
  
  const handleSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    
    // Validate project name
    const validation = validateProjectName(projectName)
    if (!validation.valid) {
      setError(validation.error)
      return
    }
    
    setLoading(true)
    setError(null)
    
    const fullPath = `${workdir}/${projectName}`
    
    try {
      // Create project via REST API
      const response = await authFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projectName, workdir: fullPath }),
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to create project')
      }
      
      const data = await response.json()
      const project = data.project
      
      // Navigate to the new project
      // Close modal first, then navigate to avoid race conditions
      onClose()
      navigate(`/p/${project.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project')
      setLoading(false)
    }
  }, [projectName, navigate, onClose, workdir])
  
  const handleCancel = useCallback(() => {
    setProjectName('')
    setError(null)
    onClose()
  }, [onClose])
  
  const fullPath = projectName ? `${workdir}/${projectName}` : ''
  
  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCancel}
      title="Create New Project"
      size="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="project-name" className="block text-sm font-medium text-text-secondary mb-2">
            Project Name
          </label>
          <Input
            ref={inputRef}
            id="project-name"
            value={projectName}
            onChange={(e) => {
              setProjectName(e.target.value)
              setError(null)
            }}
            placeholder="my-project"
            disabled={loading}
            className="w-full"
          />
          
          {/* Path preview */}
          {projectName && (
            <div className="mt-2 text-xs text-text-muted">
              Full path: <span className="font-mono">{fullPath}</span>
            </div>
          )}
          
          {/* Error message */}
          {error && (
            <div className="mt-3 p-3 bg-accent-error/10 border border-accent-error/30 rounded text-sm text-accent-error">
              {error}
            </div>
          )}
        </div>
        
        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={handleCancel}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={loading || !projectName.trim()}
            className="min-w-[100px]"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <PlusMdIcon className="h-4 w-4" />
                Creating...
              </span>
            ) : (
              'Create'
            )}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
