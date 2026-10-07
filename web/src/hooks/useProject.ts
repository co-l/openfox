import { useResource } from './useResource'
import { projectResource } from '../lib/resources'

/**
 * Single project detail with implicit loadership. Handles a null/undefined id
 * (no route project yet) by resolving to null without any fetch.
 *
 * `notFound`: the server answered that the project does not exist (404), e.g.
 * a link or a restored tab to a deleted project. Not set while loading or
 * after another failure.
 */
export function useProject(projectId: string | null | undefined) {
  const { data, loading, refresh } = useResource(projectResource, projectId ?? '')
  return { project: data ?? null, notFound: !!projectId && !loading && data === null, refresh }
}
