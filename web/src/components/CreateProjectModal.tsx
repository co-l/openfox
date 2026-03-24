import { useState, useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'wouter'
import { Modal } from './shared/Modal'
import { Button } from './shared/Button'
import { Input } from './shared/Input'
import { wsClient } from '../lib/ws'

interface CreateProjectModalProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * Validate project name - only alphanumeric, hyphens, underscores, and dots
 */
function validateProjectName(name: string): { valid: true } | { valid: false; error: string } {
  if (!name || name.trim() === '') {
    return { valid: false, error: 'Project name cannot be empty' }
  }
  
  const validPattern = /^[a-zA-Z0-9._-]+$/
  if (!validPattern.test(name)) {
    return { 
      valid: false, 
      error: 'Project name can only contain letters, numbers, hyphens, underscores, and dots' 
    }
  }
  
  return { valid: true }
}

export function CreateProjectModal({ isOpen, onClose }: CreateProjectModalProps) {
  const [, navigate] = useLocation()
  const [projectName, setProjectName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [workdir, setWorkdir] = useState<string>('')
  const inputRef = useRef<HTMLInputElement>(null)
  const responseResolver = useRef<((value: unknown) => void) | null>(null)
  const responseRejector = useRef<((reason: Error) => void) | null>(null)
  const currentMessageId = useRef<string | null>(null)
  const currentUnsubscribe = useRef<(() => void) | null>(null)
  
  // Fetch workdir from config when modal opens
  useEffect(() => {
    if (isOpen) {
      fetch('/api/config')
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
    
    // Unsubscribe from any previous handler
    if (currentUnsubscribe.current) {
      currentUnsubscribe.current()
      currentUnsubscribe.current = null
    }
    
    try {
      // Set up response handler
      const handleMessage = (message: unknown) => {
        if (typeof message !== 'object' || message === null || !('id' in message)) {
          return
        }
        
        const msg = message as { id: string; type: string; payload?: unknown; code?: string; message?: string }
        
        // Only process messages matching the current request
        if (msg.id !== currentMessageId.current) {
          return
        }
        
        if (msg.type === 'error') {
          responseRejector.current?.(new Error(msg.message || 'Unknown error'))
        } else if (msg.type === 'project.state') {
          const payload = msg.payload as { project: { id: string } }
          if (payload?.project) {
            responseResolver.current?.(payload.project)
          } else {
            responseRejector.current?.(new Error('Invalid project state response'))
          }
        }
      }
      
      currentUnsubscribe.current = wsClient.subscribe(handleMessage)
      
      // Create promise for response
      const responsePromise = new Promise((resolve, reject) => {
        responseResolver.current = resolve
        responseRejector.current = reject
        
        // Timeout after 30 seconds
        setTimeout(() => {
          reject(new Error('Request timeout'))
        }, 30000)
      })
      
      // Send the message and get the actual message ID
      const sentMessageId = wsClient.send('project.create-with-dir', { name: projectName })
      currentMessageId.current = sentMessageId
      
      // Wait for response
      const result = await responsePromise
      
      // Unsubscribe from handler
      if (currentUnsubscribe.current) {
        currentUnsubscribe.current()
        currentUnsubscribe.current = null
      }
      
      // Refresh the project list and wait for it to complete
      const listMessageId = wsClient.send('project.list', {})
      
      const listPromise = new Promise<void>((resolve, reject) => {
        let listResolved = false
        
        const listHandler = (message: unknown) => {
          if (listResolved || typeof message !== 'object' || message === null || !('id' in message)) {
            return
          }
          
          const msg = message as { id: string; type: string; payload?: unknown; code?: string; message?: string }
          
          if (msg.id === listMessageId) {
            if (msg.type === 'project.list') {
              listResolved = true
              resolve()
            } else if (msg.type === 'error') {
              listResolved = true
              reject(new Error(msg.message || 'Failed to refresh project list'))
            }
          }
        }
        
        const listUnsubscribe = wsClient.subscribe(listHandler)
        
        // Timeout after 10 seconds
        setTimeout(() => {
          if (!listResolved) {
            listUnsubscribe()
            reject(new Error('Timeout waiting for project list'))
          }
        }, 10000)
      })
      
      await listPromise
      
      // Navigate to the new project
      const project = result as { id: string }
      // Close modal first, then navigate to avoid race conditions
      onClose()
      navigate(`/p/${project.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project')
      setLoading(false)
    }
  }, [projectName, navigate, onClose])
  
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
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
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
