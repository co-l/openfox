/**
 * Command System Types
 */

export interface CommandMetadata {
  id: string
  name: string
  agentMode?: string
}

export interface CommandDefinition {
  metadata: CommandMetadata
  prompt: string
}
