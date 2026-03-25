/**
 * Command System Types
 */

export interface CommandMetadata {
  id: string
  name: string
}

export interface CommandDefinition {
  metadata: CommandMetadata
  prompt: string
}
