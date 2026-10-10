import { useEffect } from 'react'
import { useLocation } from 'wouter'
import { useProject } from './useProject'

/**
 * Go back home when the URL's project does not exist (a link or a restored tab
 * to a deleted project, or one from another OpenFox instance): the project and
 * session views otherwise wait for it on an endless spinner.
 */
export function useMissingProjectRedirect(projectId: string | undefined): void {
  const [, navigate] = useLocation()
  const { notFound } = useProject(projectId)
  useEffect(() => {
    if (notFound) navigate('/')
  }, [notFound, navigate])
}
