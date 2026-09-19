import { dedupById } from './modal-utils'
import type { CommandInfo } from './commands-actions'

export interface CommandScopes {
  defaults: CommandInfo[]
  userItems: CommandInfo[]
  projectItems: CommandInfo[]
}

export type CommandAvailability =
  | { state: 'disabled' }
  | { state: 'loading' }
  | { state: 'available'; commandId: string }
  | { state: 'needs_params'; commandId: string; paramNames: string[] }
  | { state: 'not_found'; commandId: string }

/**
 * Whether a configured command can actually run, judged from the same merged
 * command list the server resolves against (project over user over defaults).
 * Derived here rather than asked of the server so the settings tab and the
 * delete dialog agree with each other at zero extra requests - and so neither
 * has to hedge about whether the routine is there.
 */
export function resolveCommandAvailability(scopes: CommandScopes | undefined, configured: string): CommandAvailability {
  const commandId = configured.trim().replace(/^\//, '')
  if (!commandId) return { state: 'disabled' }
  if (!scopes) return { state: 'loading' }

  const merged = dedupById(dedupById(scopes.defaults, scopes.userItems), scopes.projectItems)
  const command = merged.find((item) => item.id === commandId)
  if (!command) return { state: 'not_found', commandId }

  const paramNames = command.paramNames ?? []
  return paramNames.length > 0 ? { state: 'needs_params', commandId, paramNames } : { state: 'available', commandId }
}
