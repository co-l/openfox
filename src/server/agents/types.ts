/**
 * Agent System Types
 */

export interface AgentModelRef {
  providerId: string
  model: string
}

export interface AgentMetadata {
  id: string
  name: string
  description: string
  subagent: boolean
  allowedTools: string[]
  color?: string
  results?: string[]
  modelCascade?: AgentModelRef[]
}

export interface AgentDefinition {
  metadata: AgentMetadata
  prompt: string
}
