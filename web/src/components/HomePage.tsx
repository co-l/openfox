import { useState, useEffect } from 'react'
import { useLocation } from 'wouter'
import { useSessionStore } from '../stores/session'
import { useProjectStore } from '../stores/project'
import { Button } from './shared/Button'
import { OpenProjectModal } from './CreateSessionModal'
import { DeleteProjectConfirmationModal } from './DeleteProjectConfirmationModal.js'

export function HomePage() {
  const [, navigate] = useLocation()
  const [showOpenModal, setShowOpenModal] = useState(false)
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; name: string } | null>(null)
  
  const sessions = useSessionStore(state => state.sessions)
  const projects = useProjectStore(state => state.projects)
  const listProjects = useProjectStore(state => state.listProjects)
  const listSessions = useSessionStore(state => state.listSessions)
  const deleteProject = useProjectStore(state => state.deleteProject)
  
  // Load projects and sessions on mount
  useEffect(() => {
    listProjects()
    listSessions()
  }, [listProjects, listSessions])
  
  // Get recent sessions (last 5)
  const recentSessions = sessions.slice(0, 5)
  
  // Get recent projects (last 3-5)
  const recentProjects = projects.slice(0, 5)
  
  const handleSessionClick = (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId)
    if (session) {
      const project = projects.find(p => session.workdir.startsWith(p.workdir))
      if (project) {
        navigate(`/p/${project.id}/s/${sessionId}`)
      }
    }
  }
  
  const handleProjectClick = (projectId: string) => {
    navigate(`/p/${projectId}`)
  }
  
  const handleOpenProject = () => {
    setShowOpenModal(true)
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
  
  const getPhaseBadgeClasses = (phase: string) => {
    switch (phase) {
      case 'done':
        return 'bg-green-500/20 text-green-400'
      case 'blocked':
        return 'bg-red-500/20 text-red-400'
      case 'verification':
        return 'bg-yellow-500/20 text-yellow-400'
      case 'build':
        return 'bg-blue-500/20 text-blue-400'
      case 'plan':
      default:
        return 'bg-purple-500/20 text-purple-400'
    }
  }
  
  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="max-w-5xl mx-auto w-full p-8">
        {/* Hero Section */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-accent-primary mb-2">OpenFox</h1>
          <p className="text-text-secondary">
            Local LLM-powered coding assistant with contract-driven execution
          </p>
        </div>
        
        {/* Primary CTA */}
        <div className="mb-8">
          <Button
            variant="primary"
            className="w-full py-4 text-lg font-semibold"
            onClick={handleOpenProject}
          >
            Open Project
          </Button>
        </div>
        
        {/* Recent Sessions */}
        {recentSessions.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-text-primary">
                Recent Sessions
              </h2>
            </div>
            
            <div className="bg-bg-secondary border border-border rounded overflow-hidden">
              <div className="divide-y divide-border">
                {recentSessions.map(session => {
                  const project = projects.find(p => session.workdir.startsWith(p.workdir))
                  return (
                    <div
                      key={session.id}
                      onClick={() => handleSessionClick(session.id)}
                      className="p-4 hover:bg-bg-tertiary/50 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <svg className="w-5 h-5 text-accent-primary flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                          </svg>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-text-primary truncate">
                              {project?.name ?? 'Unknown Project'}
                            </div>
                            <div className="text-sm text-text-muted truncate">
                              {session.title ?? session.id.slice(0, 8)}
                            </div>
                          </div>
                        </div>
                        
                        <span className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${getPhaseBadgeClasses(session.phase)}`}>
                          {session.phase === 'done' ? (
                            <>
                              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              done
                            </>
                          ) : session.phase === 'blocked' ? (
                            <>
                              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                              </svg>
                              blocked
                            </>
                          ) : session.phase === 'verification' ? (
                            'verify'
                          ) : session.phase}
                          {session.isRunning && session.phase !== 'done' && session.phase !== 'blocked' && ' •'}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
        
        {/* Quick Projects */}
        {recentProjects.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-text-primary mb-3">
              Quick Projects
            </h2>
            
            <div className="flex flex-wrap gap-2 mb-3">
              {recentProjects.map(project => (
                <div
                  key={project.id}
                  className="px-4 py-2 bg-bg-secondary border border-border rounded-full hover:bg-bg-tertiary hover:border-accent-primary transition-colors flex items-center gap-2 group relative"
                >
                  <button
                    onClick={() => handleProjectClick(project.id)}
                    className="flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-accent-primary" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                    </svg>
                    <span className="text-text-primary">{project.name}</span>
                  </button>
                  <button
                    onClick={(e) => handleDeleteClick(project, e)}
                    className="opacity-0 group-hover:opacity-100 text-accent-error/70 hover:text-accent-error p-1 transition-opacity ml-1"
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
      
      {/* Open Project Modal */}
      {showOpenModal && (
        <OpenProjectModal
          isOpen={showOpenModal}
          onClose={() => setShowOpenModal(false)}
        />
      )}
      
      {/* Delete Confirmation Modal */}
      {projectToDelete && (
        <DeleteProjectConfirmationModal
          isOpen={true}
          onClose={() => setProjectToDelete(null)}
          projectName={projectToDelete.name}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  )
}
