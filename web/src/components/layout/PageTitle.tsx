import { useEffect } from 'react'
import { useProjectStore } from '../../stores/project'
import { useSessionStore } from '../../stores/session'

/**
 * PageTitle component - updates document.title reactively based on current project and session context.
 * This is a presentational component that renders nothing visible.
 */
export function PageTitle() {
  const project = useProjectStore(state => state.currentProject)
  const session = useSessionStore(state => state.currentSession)
  const isDev = import.meta.env.DEV

  useEffect(() => {
    const devPrefix = isDev ? 'dev- ' : ''
    const sessionTitle = session?.metadata?.title
    
    if (project && sessionTitle) {
      // Session view: "dev-ProjectName - SessionTitle | OpenFox" or "ProjectName - SessionTitle | OpenFox"
      document.title = `${devPrefix}${project.name} - ${sessionTitle} | OpenFox`
    } else if (project) {
      // Project view (no session): "dev-ProjectName | OpenFox" or "ProjectName | OpenFox"
      document.title = `${devPrefix}${project.name} | OpenFox`
    } else {
      // Home page: "OpenFox"
      document.title = 'OpenFox'
    }
  }, [project, session, isDev])

  return null
}
