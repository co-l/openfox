import { useResource } from './useResource'
import { workflowsResource } from '../lib/resources'

/**
 * Merged workflow list (defaults + user + project) with implicit loadership via
 * the workflows resource cache — any surface that needs workflows gets them
 * without remembering to fire a fetch. Scoped by workdir so project workflows
 * are loaded for the right project.
 */
export function useWorkflows(workdir?: string) {
  const { data, refresh } = useResource(workflowsResource, workdir)
  const workflows = data ? [...data.defaults, ...data.userItems, ...data.projectItems] : []
  return { workflows, refresh }
}
