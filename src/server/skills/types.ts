/**
 * Skill System Types
 */

export interface SkillMetadata {
  id: string
  name: string
  description: string
  version: string
  [key: string]: unknown
}

export type SkillSource =
  | 'bundled'
  | 'global-shared'
  | 'global-openfox'
  | 'selected'
  | 'project-shared'
  | 'project-openfox'

export interface SkillDefinition {
  metadata: SkillMetadata
  prompt: string
  rawMetadata?: Record<string, unknown>
  entrypoint?: string
  directory?: string
  source?: SkillSource
  legacy?: boolean
  warnings?: string[]
}
