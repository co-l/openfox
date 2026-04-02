/**
 * Agent System Types
 */

export interface AgentMetadata {
  id: string
  name: string
  description: string
  subagent: boolean
  allowedTools: string[]
  color?: string
  results?: string[]
}

export interface AgentDefinition {
  metadata: AgentMetadata
  prompt: string
}
