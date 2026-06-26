import { createHash } from 'node:crypto'
import type { SkillMetadata } from '../skills/types.js'
import type { LLMToolDefinition } from '../llm/types.js'
import type { SessionManager } from '../session/manager.js'
import { getAllInstructions } from '../context/instructions.js'
import { getEnabledSkillMetadata } from '../skills/registry.js'
import { buildTopLevelSystemPrompt } from './prompts.js'
import { loadAllAgentsDefault, getSubAgents } from '../agents/registry.js'
import { getRuntimeConfig } from '../runtime-config.js'
import { getGlobalConfigDir } from '../../cli/paths.js'
import { logger } from '../utils/logger.js'

export function computeDynamicContextHash(
  instructionContent: string,
  skills: SkillMetadata[],
  toolFingerprint?: string,
): string {
  const dynamicInputs = JSON.stringify({
    instructions: instructionContent,
    skills: skills.map((s) => s.id).sort(),
    ...(toolFingerprint ? { tools: toolFingerprint } : {}),
  })
  return createHash('sha256').update(dynamicInputs).digest('hex')
}

export function getToolFingerprint(tools: LLMToolDefinition[]): string {
  return tools
    .map((t) => `${t.function.name}:${JSON.stringify(t.function.parameters)}`)
    .sort()
    .join('|')
}

export async function computeContextHash(
  sessionManager: SessionManager,
  sessionId: string,
): Promise<{ hash: string; instructionContent: string; skills: SkillMetadata[]; allTools: LLMToolDefinition[] }> {
  const session = sessionManager.requireSession(sessionId)
  const { content: instructionContent } = await getAllInstructions(session.workdir, session.projectId)
  const runtimeConfig = getRuntimeConfig()
  const configDir = getGlobalConfigDir(runtimeConfig.mode ?? 'production')
  const skills = await getEnabledSkillMetadata(configDir, runtimeConfig.workdir)

  const { createToolRegistry } = await import('../tools/index.js')
  const allTools = createToolRegistry().definitions
  const toolFingerprint = getToolFingerprint(allTools)
  const hash = computeDynamicContextHash(instructionContent, skills, toolFingerprint)

  return { hash, instructionContent, skills, allTools }
}

export async function applyDynamicContext(sessionManager: SessionManager, sessionId: string): Promise<void> {
  const { hash, instructionContent, skills, allTools } = await computeContextHash(sessionManager, sessionId)

  const allAgents = await loadAllAgentsDefault()
  const subAgentDefs = getSubAgents(allAgents)
  const systemPrompt = buildTopLevelSystemPrompt(
    sessionManager.requireSession(sessionId).workdir,
    instructionContent || undefined,
    skills,
    subAgentDefs,
  )

  sessionManager.setCachedPrompt(sessionId, systemPrompt, allTools, hash)
  sessionManager.setDynamicContextChanged(sessionId, false)
  sessionManager.clearDebugDump(sessionId)
  logger.debug('applyDynamicContext done', { sessionId, hash, toolCount: allTools.length })
}
