import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'wouter'
import { useSessionStore } from '../stores/session'
import { Button } from './shared/Button'
import { Input } from './shared/Input'

export function SessionSelector() {
  const [workdir, setWorkdir] = useState('')
  const [title, setTitle] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [, navigate] = useLocation()
  const pendingCreate = useRef(false)
  
  const sessions = useSessionStore(state => state.sessions)
  const currentSession = useSessionStore(state => state.currentSession)
  const createSession = useSessionStore(state => state.createSession)
  const deleteSession = useSessionStore(state => state.deleteSession)
  
  // Navigate to session when created (only if we triggered the create)
  useEffect(() => {
    if (currentSession && pendingCreate.current) {
      pendingCreate.current = false
      navigate(`/session/${currentSession.id}`)
    }
  }, [currentSession, navigate])
  
  const handleCreate = () => {
    if (!workdir.trim()) return
    pendingCreate.current = true
    createSession(workdir, title || undefined)
    setWorkdir('')
    setTitle('')
    setShowNew(false)
  }
  
  const handleLoadSession = (sessionId: string) => {
    navigate(`/session/${sessionId}`)
  }
  
  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-accent-primary mb-2">OpenFox</h1>
          <p className="text-text-secondary">
            Local LLM-powered coding assistant with contract-driven execution
          </p>
        </div>
        
        {showNew ? (
          <div className="bg-bg-secondary border border-border rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">New Session</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1">
                  Working Directory *
                </label>
                <Input
                  value={workdir}
                  onChange={(e) => setWorkdir(e.target.value)}
                  placeholder="/path/to/your/project"
                  className="w-full"
                />
              </div>
              
              <div>
                <label className="block text-sm text-text-secondary mb-1">
                  Session Title (optional)
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="My awesome feature"
                  className="w-full"
                />
              </div>
              
              <div className="flex gap-2">
                <Button variant="primary" onClick={handleCreate} disabled={!workdir.trim()}>
                  Create Session
                </Button>
                <Button onClick={() => setShowNew(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Button
              variant="primary"
              className="w-full py-4"
              onClick={() => setShowNew(true)}
            >
              + New Session
            </Button>
            
            {sessions.length > 0 && (
              <div className="bg-bg-secondary border border-border rounded-lg overflow-hidden">
                <div className="p-3 border-b border-border">
                  <h2 className="font-semibold text-sm text-text-secondary">
                    Recent Sessions
                  </h2>
                </div>
                
                <div className="divide-y divide-border">
                  {sessions.map(session => (
                    <div
                      key={session.id}
                      className="p-4 hover:bg-bg-tertiary/50 flex items-center justify-between group"
                    >
                      <button
                        className="flex-1 text-left"
                        onClick={() => handleLoadSession(session.id)}
                      >
                        <div className="font-medium">
                          {session.title ?? session.id.slice(0, 8)}
                        </div>
                        <div className="text-sm text-text-muted truncate">
                          {session.workdir}
                        </div>
                        <div className="flex gap-2 mt-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            session.phase === 'completed' 
                              ? 'bg-accent-success/20 text-accent-success'
                              : session.phase === 'executing'
                              ? 'bg-accent-warning/20 text-accent-warning'
                              : 'bg-bg-tertiary text-text-muted'
                          }`}>
                            {session.phase}
                          </span>
                          <span className="text-xs text-text-muted">
                            {session.criteriaCompleted}/{session.criteriaCount} criteria
                          </span>
                        </div>
                      </button>
                      
                      <button
                        className="opacity-0 group-hover:opacity-100 text-accent-error/70 hover:text-accent-error p-2"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (confirm('Delete this session?')) {
                            deleteSession(session.id)
                          }
                        }}
                      >
                        ✕
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
