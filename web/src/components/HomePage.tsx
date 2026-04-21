import { useState, useEffect } from 'react'
import { Link } from 'wouter'
import { useSessionStore } from '../stores/session'
import { useProjectStore } from '../stores/project'
import { Button } from './shared/Button'
import { OpenProjectModal } from './CreateSessionModal'
import { formatRelativeDate } from '../lib/format-date'
import { FolderIcon } from './shared/icons'

export function HomePage() {
  const [showOpenModal, setShowOpenModal] = useState(false)

  const sessions = useSessionStore((state) => state.sessions)
  const projects = useProjectStore((state) => state.projects)
  const listProjects = useProjectStore((state) => state.listProjects)
  const listSessions = useSessionStore((state) => state.listSessions)

  const connectionStatus = useSessionStore(state => state.connectionStatus)

  useEffect(() => {
    if (connectionStatus === 'connected') {
      listProjects()
      listSessions()
    }
  }, [connectionStatus, listProjects, listSessions])

  const sortedProjects = [...projects].sort((a, b) => {
    const sessionsInA = sessions.filter((s) => s.workdir.startsWith(a.workdir))
    const sessionsInB = sessions.filter((s) => s.workdir.startsWith(b.workdir))
    const lastSessionA =
      sessionsInA.length > 0
        ? new Date(
            sessionsInA.reduce((latest, s) => (new Date(s.updatedAt) > new Date(latest.updatedAt) ? s : latest))
              .updatedAt,
          ).getTime()
        : new Date(a.updatedAt).getTime()
    const lastSessionB =
      sessionsInB.length > 0
        ? new Date(
            sessionsInB.reduce((latest, s) => (new Date(s.updatedAt) > new Date(latest.updatedAt) ? s : latest))
              .updatedAt,
          ).getTime()
        : new Date(b.updatedAt).getTime()
    return lastSessionB - lastSessionA
  })

  const getProjectSessions = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId)
    if (!project) return []
    return sessions
      .filter((s) => s.workdir.startsWith(project.workdir))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5)
  }

  const handleOpenProject = () => {
    setShowOpenModal(true)
  }

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="max-w-5xl mx-auto w-full p-4 md:p-8">
        <div className="mb-6 md:mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-accent-primary">OpenFox</h1>
            <p className="text-text-secondary">Local LLM-powered coding assistant with contract-driven execution</p>
          </div>
          <Button variant="primary" onClick={handleOpenProject}>
            Open Project
          </Button>
        </div>

        {sortedProjects.map((project) => {
          const projectSessions = getProjectSessions(project.id)
          return (
            <div key={project.id} className="mb-6 md:mb-8">
              <div className="bg-bg-secondary border border-border rounded-lg overflow-hidden">
                <div className="p-3 md:p-4 border-b border-border flex items-center justify-between gap-2">
                  <Link
                    href={`/p/${project.id}`}
                    className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity flex-1"
                  >
                    <FolderIcon className="w-5 h-5 text-accent-primary flex-shrink-0" />
                    <span className="text-text-primary font-semibold">{project.name}</span>
                  </Link>
                  <Link
                    href={`/p/${project.id}/new`}
                    className="rounded font-medium transition-colors bg-accent-primary/25 text-white hover:bg-accent-primary/40 px-1.5 py-1 text-xs"
                  >
                    + New Session
                  </Link>
                </div>
                <div className="divide-y divide-border">
                  {projectSessions.length > 0 ? (
                    projectSessions.map((session) => {
                      const project = projects.find((p) => session.workdir.startsWith(p.workdir))
                      const href = project ? `/p/${project.id}/s/${session.id}` : '#'
                      return (
                        <Link
                          key={session.id}
                          href={href}
                          className="block p-3 md:p-4 hover:bg-bg-tertiary/50 cursor-pointer transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <div className="flex-1 min-w-0">
                                <div className="text-sm text-text-muted truncate">
                                  {session.title ?? session.id.slice(0, 8)}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-text-muted text-xs">{formatRelativeDate(session.updatedAt)}</span>
                              <span className="text-text-muted text-xs">{session.messageCount} msgs</span>
                            </div>
                          </div>
                        </Link>
                      )
                    })
                  ) : (
                    <div className="p-3 md:p-4 text-text-muted text-sm">No sessions yet</div>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {sortedProjects.length === 0 && (
          <div className="text-center py-12 text-text-muted">
            No projects yet. Open a project to get started.
          </div>
        )}
      </div>

      {showOpenModal && <OpenProjectModal isOpen={showOpenModal} onClose={() => setShowOpenModal(false)} />}
    </div>
  )
}
