import {
  loadDefaultCommands,
  loadUserCommands,
  loadProjectCommands,
  loadAllCommands,
  findCommandById,
  saveCommand,
  saveCommandToProject,
  deleteCommand,
  deleteProjectCommand,
  commandExists,
  isDefaultCommand,
  getDefaultCommandIds,
} from '../commands/registry.js'
import type { CommandDefinition } from '../commands/types.js'
import { createCrudRoutes, validateNameIdPrompt, type CrudRouteConfig } from './crud-helpers.js'
import { templateParamHints } from '../../shared/slash-args.js'

const config: CrudRouteConfig<CommandDefinition> = {
  dirName: 'commands',
  ext: '.command.md',
  loadDefaults: loadDefaultCommands,
  loadUser: loadUserCommands,
  loadProject: loadProjectCommands,
  loadAll: loadAllCommands,
  findById: findCommandById,
  save: saveCommand,
  saveToProject: saveCommandToProject,
  delete: deleteCommand,
  deleteProject: deleteProjectCommand,
  exists: commandExists,
  isDefault: isDefaultCommand,
  getDefaultIds: getDefaultCommandIds,
  validateCreate: validateNameIdPrompt,
  mapToResponse: (c) =>
    ({
      ...c.metadata,
      paramNames: templateParamHints(c.prompt),
    }) as unknown as { [key: string]: unknown },
}

export function createCommandRoutes(configDir: string, projectDir?: string) {
  return createCrudRoutes<CommandDefinition>(config, configDir, projectDir)
}
