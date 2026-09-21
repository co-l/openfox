import { useProjectStore } from '../stores/project'
import { useProject } from './useProject'

/**
 * The currently open project (detail resource) — local UI state ("which project
 * is open") layered on top of the project resource cache.
 */
export function useCurrentProject() {
  const currentProjectId = useProjectStore((state) => state.currentProjectId)
  const { project } = useProject(currentProjectId)
  return project
}
