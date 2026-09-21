import { authFetch } from './api'
import { saveEntity, duplicateEntity } from './entity-mutations'
import { commandsResource, commandResource, scopedUrl } from './resources'

export interface CommandInfo {
  id: string
  name: string
  agentMode?: string
  paramNames?: string[]
  /** Set when the command is contributed by a plugin (its package name). */
  pluginId?: string
}

export interface CommandFull {
  metadata: { id: string; name: string; agentMode?: string }
  prompt: string
}

export async function createCommand(
  command: CommandFull,
  destination?: 'project' | 'user',
  workdir?: string,
): Promise<{ success: boolean; error?: string }> {
  const result = await saveEntity('POST', scopedUrl('/api/commands', workdir), {
    ...command,
    destination,
  } as unknown as Record<string, unknown>)
  if (result.success) await commandsResource.refresh(workdir)
  return result
}

export async function updateCommand(
  id: string,
  command: Partial<CommandFull>,
  workdir?: string,
): Promise<{ success: boolean; error?: string }> {
  const result = await saveEntity(
    'PUT',
    scopedUrl(`/api/commands/${id}`, workdir),
    command as unknown as Record<string, unknown>,
  )
  if (result.success) {
    await commandsResource.refresh(workdir)
    commandResource.invalidate(id, workdir)
  }
  return result
}

export async function deleteCommand(
  commandId: string,
  workdir?: string,
): Promise<{ success: boolean; error?: string; reason?: string }> {
  try {
    const res = await authFetch(scopedUrl(`/api/commands/${commandId}`, workdir), { method: 'DELETE' })
    const data = await res.json()
    if (res.ok) {
      await commandsResource.refresh(workdir)
      commandResource.invalidate(commandId, workdir)
      return { success: true }
    }
    return { success: false, error: data.error ?? 'Failed to delete' }
  } catch {
    return { success: false, error: 'Network error' }
  }
}

export async function duplicateCommand(
  commandId: string,
  destination?: 'project' | 'user',
  workdir?: string,
): Promise<{ success: boolean; error?: string }> {
  return duplicateEntity(
    scopedUrl(`/api/commands/${commandId}/duplicate`, workdir),
    async () => {
      await commandsResource.refresh(workdir)
    },
    destination,
  )
}
