/**
 * Skill System Types
 */

export interface SkillMetadata {
  id: string
  name: string
  description: string
  version: string
}

export interface SkillDefinition {
  metadata: SkillMetadata
  prompt: string
}
