/**
 * Load Skill Tool
 *
 * Allows agents to load a skill's full instructions into context on demand.
 */

import type { ToolResult } from './types.js'
import { createTool, type ToolHandler } from './tool-helpers.js'
import { loadAllSkills, findSkillById, isSkillEnabled } from '../skills/registry.js'
import { getRuntimeConfig } from '../runtime-config.js'
import { getGlobalConfigDir } from '../../cli/paths.js'
import type { SkillDefinition } from '../skills/types.js'

interface LoadSkillArgs {
  skillId: string
}

export function formatSkillPrompt(skill: SkillDefinition): string {
  if (skill.legacy !== false || !skill.directory) return skill.prompt
  return `Skill package directory: ${skill.directory}\nResolve relative paths in these instructions from that directory.\n\n${skill.prompt}`
}

const handler: ToolHandler<LoadSkillArgs> = async (args, _context, helpers): Promise<ToolResult> => {
  const { skillId } = args

  if (!skillId) {
    return helpers.error('Missing required parameter: skillId')
  }

  if (!isSkillEnabled(skillId)) {
    return helpers.error(`Skill "${skillId}" is not enabled.`)
  }

  const config = getRuntimeConfig()
  const configDir = getGlobalConfigDir(config.mode ?? 'production')
  const allSkills = await loadAllSkills(configDir, config.workdir)
  const skill = findSkillById(skillId, allSkills)

  if (!skill) {
    const available = allSkills.map((s) => s.metadata.id).join(', ')
    return helpers.error(`Skill "${skillId}" not found. Available skills: ${available}`)
  }

  return helpers.success(formatSkillPrompt(skill))
}

export const loadSkillTool = createTool<LoadSkillArgs>(
  'load_skill',
  {
    type: 'function',
    function: {
      name: 'load_skill',
      description:
        "Load a skill's detailed instructions into context. Use this when you need domain-specific knowledge for a task. Call with the skill ID shown in the AVAILABLE SKILLS section.",
      parameters: {
        type: 'object',
        properties: {
          skillId: {
            type: 'string',
            description: 'ID of the skill to load (e.g. "playwright-cli")',
          },
        },
        required: ['skillId'],
      },
    },
  },
  handler,
)
