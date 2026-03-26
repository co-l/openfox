/**
 * Agent System Types
 */

export interface AgentMetadata {
  id: string
  name: string
  description: string
  subagent: boolean
  tools: string[]
}

export interface AgentDefinition {
  metadata: AgentMetadata
  prompt: string
}
