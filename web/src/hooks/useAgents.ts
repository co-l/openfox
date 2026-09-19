import { useResource } from './useResource'
import { agentsResource } from '../lib/resources'

/**
 * Merged agent list (defaults + user + project) with implicit loadership via
 * the agents resource cache — any surface that needs agents gets them without
 * remembering to fire a fetch. Scoped by workdir so project agents are loaded
 * for the right project.
 */
export function useAgents(workdir?: string) {
  const { data, refresh } = useResource(agentsResource, workdir)
  const agents = data ? [...data.defaults, ...data.userItems, ...data.projectItems] : []
  const modelOverrides = data?.modelOverrides ?? {}
  return { agents, modelOverrides, refresh }
}
