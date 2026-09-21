import { useResource } from './useResource'
import { projectResource } from '../lib/resources'

/**
 * Single project detail with implicit loadership. Handles a null/undefined id
 * (no route project yet) by resolving to null without any fetch.
 */
export function useProject(projectId: string | null | undefined) {
  const { data, refresh } = useResource(projectResource, projectId ?? '')
  return { project: data ?? null, refresh }
}
