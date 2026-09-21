/**
 * Command System Types
 */

export interface CommandMetadata {
  id: string
  name: string
  agentMode?: string
  /** Set when the command is contributed by a plugin (its package name). */
  pluginId?: string
}

export interface CommandDefinition {
  metadata: CommandMetadata
  prompt: string
}
