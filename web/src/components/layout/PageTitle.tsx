import { useEffect } from 'react'
import { useCurrentProject } from '../../hooks/useCurrentProject'
import { useSessionStore, useIsRunning } from '../../stores/session'

const RUNNING_PREFIX = '● '

/**
 * PageTitle component - updates document.title reactively based on current project and session context.
 * This is a presentational component that renders nothing visible.
 */
export function PageTitle() {
  const project = useCurrentProject()
  const sessionTitle = useSessionStore((state) => state.currentSession?.metadata?.title)
  const isRunning = useIsRunning()
  const isDev = import.meta.env.DEV

  const devSuffix = isDev && project ? '-dev' : ''
  const prefix = isRunning ? RUNNING_PREFIX : ''
  const projectName = project?.name
  const title =
    projectName && sessionTitle
      ? `${prefix}${projectName} - ${sessionTitle} | OpenFox${devSuffix}`
      : projectName
        ? `${prefix}${projectName} | OpenFox${devSuffix}`
        : `${prefix}OpenFox`

  useEffect(() => {
    if (document.title !== title) document.title = title
  }, [title])

  useEffect(() => {
    if (sessionTitle) document.documentElement.setAttribute('data-session-title', sessionTitle)
  }, [sessionTitle])

  return null
}
