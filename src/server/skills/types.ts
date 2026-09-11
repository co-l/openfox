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
  | 'global-claude'
  | 'global-openfox'
  | 'selected'
  | 'project-shared'
  | 'project-claude'
  | 'project-openfox'

/** Sources discovered outside OpenFox's own config; editable only in portable format. */
export const EXTERNAL_SKILL_SOURCES: readonly SkillSource[] = [
  'global-shared',
  'global-claude',
  'selected',
  'project-shared',
  'project-claude',
]

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
