/**
 * Sub-Agent Types
 * 
 * Core type definitions for the sub-agent framework.
 */

import type { Session, PromptContext } from '../../shared/types.js'

/**
 * Type of sub-agent
 */
export type SubAgentType = 'verifier' | 'code_reviewer' | 'test_generator' | 'debugger'

/**
 * Arguments for creating sub-agent context
 */
export interface SubAgentContextArgs {
  prompt: string
  [key: string]: unknown
}

/**
 * Definition of a sub-agent type
 */
export interface SubAgentDefinition {
  /** Unique identifier for this sub-agent type */
  id: SubAgentType
  
  /** Display name for this sub-agent */
  name: string
  
  /** Description of what this sub-agent does (shown to main agent) */
  description: string
  
  /** System prompt template for this sub-agent */
  systemPrompt: string
  
  /** List of tool names available to this sub-agent */
  tools: string[]
  
  /** Function to build fresh context for this sub-agent */
  createContext: (session: Session, args: SubAgentContextArgs) => PromptContext
}

/**
 * Sub-agent registry interface
 */
export interface SubAgentRegistry {
  /** Get a sub-agent definition by ID */
  getSubAgent(id: string): SubAgentDefinition | undefined
  
  /** Get all registered sub-agent definitions */
  getAllSubAgents(): SubAgentDefinition[]
  
  /** Get tool names for a specific sub-agent type */
  getToolRegistry(subAgentType: string): string[]
}
