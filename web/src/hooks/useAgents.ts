import { useAgentsStore } from '../stores/agents'

/**
 * Merged agent list (defaults + user + project) plus the lazy loader, so any
 * surface that needs agents can populate the store on demand — the chat
 * composer, the task editor, and the board all read the same source.
 */
export function useAgents() {
  const defaults = useAgentsStore((state) => state.defaults)
  const userItems = useAgentsStore((state) => state.userItems)
  const projectItems = useAgentsStore((state) => state.projectItems)
  const fetchAgents = useAgentsStore((state) => state.fetchAgents)
  return { agents: [...defaults, ...userItems, ...projectItems], fetchAgents }
}
