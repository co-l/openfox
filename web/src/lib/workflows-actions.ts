import { authFetch } from './api'
import { saveEntity, duplicateEntity } from './entity-mutations'
import { projectsResource, settingResource, SETTINGS_KEYS, workflowsResource, workflowResource } from './resources'
import type { WorkflowParameter, WorkflowScope } from '@shared/types.js'

export type { WorkflowParameter }
export type { WorkflowScope }

export interface WorkflowCondition {
  type: string
  result?: string
  key?: string
  field?: string
  value?: string
  values?: string[]
}

export interface WorkflowInfo {
  id: string
  name: string
  description: string
  version: string
  color?: string
  startCondition?: WorkflowCondition
  subGroups?: string[]
  parameters?: WorkflowParameter[]
  /** Which scope this definition lives in (server-annotated). */
  scope: WorkflowScope
}

export interface WorkflowStep {
  id: string
  name: string
  type: 'agent' | 'sub_agent' | 'shell' | 'user'
  phase: string
  transitions: Array<{ when: WorkflowCondition; goto: string; subGroup?: string }>
  agentId?: string
  subAgentType?: string
  prompt?: string
  nudgePrompt?: string
  command?: string
  timeout?: number
  successExitCodes?: number[]
  subGroup?: string
}

export interface WorkflowFull {
  metadata: {
    id: string
    name: string
    description: string
    version: string
    color?: string
    parameters?: WorkflowParameter[]
  }
  entryStep: string
  settings: { maxIterations: number }
  steps: WorkflowStep[]
  startCondition?: WorkflowCondition
}

export interface TemplateVariable {
  name: string
  description: string
}

const workdirQuery = (workdir: string | undefined): string => (workdir ? `?workdir=${encodeURIComponent(workdir)}` : '')

const scopeQuery = (scope: WorkflowScope | undefined): string => (scope ? `&scope=${scope}` : '')

export async function createWorkflow(
  workflow: WorkflowFull,
  destination?: 'project' | 'user',
  workdir?: string,
): Promise<{ success: boolean; error?: string }> {
  const result = await saveEntity('POST', `/api/workflows${workdirQuery(workdir)}`, {
    ...workflow,
    destination,
  } as unknown as Record<string, unknown>)
  if (result.success) await workflowsResource.refresh(workdir)
  return result
}

export async function updateWorkflow(
  id: string,
  workflow: Partial<WorkflowFull>,
  workdir?: string,
  scope?: WorkflowScope,
): Promise<{ success: boolean; error?: string }> {
  const result = await saveEntity(
    'PUT',
    `/api/workflows/${id}${workdirQuery(workdir)}${scopeQuery(scope)}`,
    workflow as unknown as Record<string, unknown>,
  )
  if (result.success) {
    await workflowsResource.refresh(workdir)
    workflowResource.invalidate(id, workdir, scope)
  }
  return result
}

export async function deleteWorkflow(
  id: string,
  scope: WorkflowScope,
  workdir?: string,
): Promise<{ success: boolean; error?: string; reason?: string }> {
  try {
    const res = await authFetch(`/api/workflows/${id}${workdirQuery(workdir)}${scopeQuery(scope)}`, {
      method: 'DELETE',
    })
    const data = await res.json()
    if (res.ok) {
      await workflowsResource.refresh(workdir)
      workflowResource.invalidate(id, workdir, scope)
      // The server resets any favorite-workflow config referencing the deleted
      // id; drop the cached config reads so the fields show the defaults again.
      settingResource.invalidate(SETTINGS_KEYS.FAVORITE_WORKFLOW)
      projectsResource.invalidate()
      return { success: true }
    }
    return { success: false, error: data.error ?? 'Failed to delete' }
  } catch {
    return { success: false, error: 'Network error' }
  }
}

export async function duplicateWorkflow(
  id: string,
  destination?: 'project' | 'user',
  workdir?: string,
): Promise<{ success: boolean; error?: string }> {
  return duplicateEntity(
    `/api/workflows/${id}/duplicate${workdirQuery(workdir)}`,
    async () => {
      await workflowsResource.refresh(workdir)
    },
    destination,
  )
}
