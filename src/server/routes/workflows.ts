import { Router } from 'express'
import {
  loadDefaultWorkflows,
  loadUserWorkflows,
  loadProjectWorkflows,
  loadAllWorkflows,
  findWorkflowById,
  saveWorkflow,
  saveWorkflowToProject,
  deleteWorkflow,
  deleteProjectWorkflow,
  workflowExists,
  isDefaultWorkflow,
  getDefaultWorkflowIds,
} from '../workflows/registry.js'
import { TEMPLATE_VARIABLES } from '../workflows/executor.js'
import type { WorkflowDefinition } from '../workflows/types.js'
import type { Config } from '../../shared/types.js'
import { createCrudRoutes, type CrudRouteConfig } from './crud-helpers.js'

export function createWorkflowRoutes(configDir: string, config: Config, projectDir?: string): Router {
  const crudConfig: CrudRouteConfig<WorkflowDefinition> = {
    dirName: 'workflows',
    ext: '.workflow.json',
    loadDefaults: loadDefaultWorkflows,
    loadUser: loadUserWorkflows,
    loadProject: loadProjectWorkflows,
    loadAll: loadAllWorkflows,
    findById: findWorkflowById,
    save: saveWorkflow,
    saveToProject: saveWorkflowToProject,
    delete: deleteWorkflow,
    deleteProject: deleteProjectWorkflow,
    exists: workflowExists,
    isDefault: isDefaultWorkflow,
    getDefaultIds: getDefaultWorkflowIds,
    validateCreate: (body) => {
      const steps = body['steps']
      if (!Array.isArray(steps) || steps.length === 0) return 'Missing required fields: metadata.id, steps'
      return null
    },
    mapToResponse: (w) => {
      const subGroups = [...new Set(w.steps.map((s) => s.subGroup).filter(Boolean))] as string[]
      return {
        ...w.metadata,
        startCondition: w.startCondition,
        subGroups: subGroups.length > 0 ? subGroups : undefined,
      } as unknown as { [key: string]: unknown }
    },
    extraGetData: () => Promise.resolve({ activeWorkflowId: config.activeWorkflowId ?? 'default' }),
    extraRoutes: (router) => {
      router.get('/template-variables', (_req, res) => {
        res.json({ variables: TEMPLATE_VARIABLES })
      })
    },
  }

  return createCrudRoutes<WorkflowDefinition>(crudConfig, configDir, projectDir)
}
