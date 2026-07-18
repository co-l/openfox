import {
  loadDefaultAgents,
  loadUserAgents,
  loadProjectAgents,
  loadAllAgents,
  findAgentById,
  saveAgent,
  saveAgentToProject,
  deleteAgent,
  deleteProjectAgent,
  agentExists,
  isDefaultAgent,
  getDefaultAgentIds,
} from '../agents/registry.js'
import type { AgentDefinition } from '../agents/types.js'
import { createCrudRoutes, type CrudRouteConfig } from './crud-helpers.js'
import { getRuntimeConfig } from '../runtime-config.js'

export function validateModelCascade(
  body: Record<string, unknown>,
  providers = getRuntimeConfig().providers ?? [],
): string | null {
  const metadata = body['metadata'] as Record<string, unknown> | undefined
  const cascade = metadata?.['modelCascade']
  if (cascade === undefined || cascade === null) return null
  if (!Array.isArray(cascade) || cascade.length === 0) return 'Model cascade must be a non-empty array when enabled'
  const refs = cascade as Array<Record<string, unknown>>
  if (refs.some((ref) => !ref || typeof ref !== 'object' || !ref['providerId'] || !ref['model'])) {
    return 'Each model cascade entry requires providerId and model'
  }
  const keys = refs.map((ref) => `${String(ref['providerId'])}\u0000${String(ref['model'])}`)
  if (new Set(keys).size !== keys.length) return 'Model cascade cannot contain duplicate models'
  for (const ref of refs) {
    const provider = providers.find((item) => item.id === String(ref['providerId']))
    if (!provider) return `Unknown provider in model cascade: ${String(ref['providerId'])}`
    if (!provider.models.some((item) => item.id === String(ref['model']))) {
      return `Unknown model in model cascade: ${String(ref['providerId'])}/${String(ref['model'])}`
    }
  }
  return null
}

const config: CrudRouteConfig<AgentDefinition> = {
  dirName: 'agents',
  ext: '.agent.md',
  loadDefaults: loadDefaultAgents,
  loadUser: loadUserAgents,
  loadProject: loadProjectAgents,
  loadAll: loadAllAgents,
  findById: findAgentById,
  save: saveAgent,
  saveToProject: saveAgentToProject,
  delete: deleteAgent,
  deleteProject: deleteProjectAgent,
  exists: agentExists,
  isDefault: isDefaultAgent,
  getDefaultIds: getDefaultAgentIds,
  validateCreate: (body) => {
    const meta = body['metadata'] as Record<string, unknown> | undefined
    if (!meta?.['id'] || !body['prompt']) return 'Missing required fields: metadata.id, prompt'
    return validateModelCascade(body)
  },
  validateUpdate: validateModelCascade,
  mapToResponse: (a) => a.metadata as unknown as { [key: string]: unknown },
}

export function createAgentRoutes(
  configDir: string,
  projectDir?: string,
  getProviders: () => import('../../shared/types.js').Provider[] = () => getRuntimeConfig().providers ?? [],
) {
  const routeConfig: CrudRouteConfig<AgentDefinition> = {
    ...config,
    validateCreate: (body) => {
      const meta = body['metadata'] as Record<string, unknown> | undefined
      if (!meta?.['id'] || !body['prompt']) return 'Missing required fields: metadata.id, prompt'
      return validateModelCascade(body, getProviders())
    },
    validateUpdate: (body) => validateModelCascade(body, getProviders()),
  }
  return createCrudRoutes<AgentDefinition>(routeConfig, configDir, projectDir)
}
