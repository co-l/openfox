import { useCallback } from 'react'
import { useResource } from './useResource'
import { workflowsResource, revalidateWorkflows } from '../lib/resources'

/**
 * Merged workflow list (defaults + user + project) with implicit loadership via
 * the workflows resource cache — any surface that needs workflows gets them
 * without remembering to fire a fetch. Scoped by workdir so project workflows
 * are loaded for the right project.
 *
 * `revalidate()` is the shared way for a workflow-consuming surface to pick up
 * edits made elsewhere: freshness-gated, so it is safe to call on every user
 * interaction (see `revalidateWorkflows`).
 */
export function useWorkflows(workdir?: string) {
  const { data, refresh } = useResource(workflowsResource, workdir)
  const workflows = data ? [...data.defaults, ...data.userItems, ...data.projectItems] : []
  const revalidate = useCallback(() => revalidateWorkflows(workdir), [workdir])
  return { workflows, refresh, revalidate }
}
