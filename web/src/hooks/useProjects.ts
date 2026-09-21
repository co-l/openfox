import { useResource } from './useResource'
import { projectsResource } from '../lib/resources'

/**
 * All projects (global list) with implicit loadership via the projects resource
 * cache — no consumer needs to remember to fire a fetch.
 */
export function useProjects() {
  const { data, refresh, loading } = useResource(projectsResource)
  const projects = data?.projects ?? []
  return { projects, refresh, loading }
}
