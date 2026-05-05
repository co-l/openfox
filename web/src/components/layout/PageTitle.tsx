import { useEffect, useRef } from 'react'
import { useProjectStore } from '../../stores/project'
import { useSessionStore, useIsRunning } from '../../stores/session'

const SPINNER_CHARS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴']

/**
 * PageTitle component - updates document.title reactively based on current project and session context.
 * This is a presentational component that renders nothing visible.
 */
export function PageTitle() {
  const project = useProjectStore((state) => state.currentProject)
  const session = useSessionStore((state) => state.currentSession)
  const isRunning = useIsRunning()
  const isDev = import.meta.env.DEV
  const spinnerIndexRef = useRef(0)
  const intervalRef = useRef<number | null>(null)

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = window.setInterval(() => {
        spinnerIndexRef.current = (spinnerIndexRef.current + 1) % SPINNER_CHARS.length
        updateTitle()
      }, 150)
      updateTitle()
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      updateTitle()
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isRunning, project, session, isDev])

  const updateTitle = () => {
    const devPrefix = isDev ? 'dev- ' : ''
    const sessionTitle = session?.metadata?.title
    const spinnerPrefix = isRunning ? `${SPINNER_CHARS[spinnerIndexRef.current]} ` : ''

    if (project && sessionTitle) {
      document.title = `${spinnerPrefix}${devPrefix}${project.name} - ${sessionTitle} | OpenFox`
    } else if (project) {
      document.title = `${spinnerPrefix}${devPrefix}${project.name} | OpenFox`
    } else {
      document.title = `${spinnerPrefix}OpenFox`
    }
  }

  // Expose session title for E2E tests
  if (typeof window !== 'undefined' && session?.metadata?.title) {
    window.document.documentElement.setAttribute('data-session-title', session.metadata.title)
  }

  return null
}
