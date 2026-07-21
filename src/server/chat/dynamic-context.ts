import { createHash } from 'node:crypto'
import type { SkillMetadata } from '../skills/types.js'
import type { LLMToolDefinition } from '../llm/types.js'
import type { SessionManager } from '../session/manager.js'
import type { AgentDefinition } from '../agents/types.js'
import { getAllInstructions } from '../context/instructions.js'
import { getEnabledSkillMetadata } from '../skills/registry.js'
import { buildTopLevelPromptParts, joinTopLevelPromptParts } from './prompts.js'
import { loadAllAgentsDefault, getSubAgents, findAgentById } from '../agents/registry.js'
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

async function loadSessionContext(
  sessionManager: SessionManager,
  sessionId: string,
): Promise<{ instructionContent: string; skills: SkillMetadata[] }> {
  const session = sessionManager.requireSession(sessionId)
  const { content: instructionContent } = await getAllInstructions(session.workdir, session.projectId)
  const runtimeConfig = getRuntimeConfig()
  const configDir = getGlobalConfigDir(runtimeConfig.mode ?? 'production')
  const skills = await getEnabledSkillMetadata(configDir, runtimeConfig.workdir)
  return { instructionContent: instructionContent ?? '', skills }
}

function resolveAgentDef(sessionManager: SessionManager, sessionId: string): Promise<AgentDefinition> {
  return loadAllAgentsDefault().then((allAgents) => {
    const session = sessionManager.requireSession(sessionId)
    return findAgentById(session.mode, allAgents) ?? findAgentById('planner', allAgents)!
  })
}

/**
 * Build the cached prompt for a session using the correct filtered tool list.
 * Single source of truth — used by both eager (applyDynamicContext) and lazy
 * (assembleRequest cache-miss) paths.
 */
export async function buildCachedPrompt(
  sessionManager: SessionManager,
  sessionId: string,
  agentDef: AgentDefinition,
): Promise<{
  systemPrompt: string
  tools: LLMToolDefinition[]
  hash: string
  compactionFloor: { totalTokens: number; segments: import('../../shared/types.js').CompactionFloorSegment[] }
}> {
  const { instructionContent, skills } = await loadSessionContext(sessionManager, sessionId)

  const { getToolRegistryForAgent } = await import('../tools/index.js')
  const tools = getToolRegistryForAgent(agentDef).definitions
  const toolFingerprint = getToolFingerprint(tools)

  const allAgents = await loadAllAgentsDefault()
  const subAgentDefs = getSubAgents(allAgents)
  const session = sessionManager.requireSession(sessionId)
  const promptParts = buildTopLevelPromptParts(session.workdir, instructionContent || undefined, skills, subAgentDefs)
  const systemPrompt = joinTopLevelPromptParts(promptParts)
  const { estimateCompactionFloor } = await import('../context/compactor.js')
  const { getMcpToolNames } = await import('../tools/index.js')
  const compactionFloor = estimateCompactionFloor({ promptParts, tools, mcpToolNames: getMcpToolNames() })

  const hash = computeDynamicContextHash(instructionContent, skills, toolFingerprint)

  return { systemPrompt, tools, hash, compactionFloor }
}

export async function computeSessionCompactionFloor(
  sessionManager: SessionManager,
  sessionId: string,
): Promise<{ totalTokens: number; segments: import('../../shared/types.js').CompactionFloorSegment[] }> {
  const cached = sessionManager.getCachedPrompt(sessionId)
  if (cached?.compactionFloor) return cached.compactionFloor

  const agentDef = await resolveAgentDef(sessionManager, sessionId)
  const result = await buildCachedPrompt(sessionManager, sessionId, agentDef)
  sessionManager.setCachedPrompt(sessionId, result.systemPrompt, result.tools, result.hash, result.compactionFloor)
  return result.compactionFloor
}

/**
 * Compute the dynamic context hash for a session using the correct filtered tool list.
 * Used by context.checkDynamic and session.load to detect drift.
 */
export async function computeSessionHash(sessionManager: SessionManager, sessionId: string): Promise<string> {
  const { instructionContent, skills } = await loadSessionContext(sessionManager, sessionId)
  const agentDef = await resolveAgentDef(sessionManager, sessionId)

  const { getToolRegistryForAgent } = await import('../tools/index.js')
  const tools = getToolRegistryForAgent(agentDef).definitions
  const toolFingerprint = getToolFingerprint(tools)

  return computeDynamicContextHash(instructionContent, skills, toolFingerprint)
}

export async function applyDynamicContext(sessionManager: SessionManager, sessionId: string): Promise<void> {
  const session = sessionManager.requireSession(sessionId)
  const allAgents = await loadAllAgentsDefault()
  const agentDef = findAgentById(session.mode, allAgents) ?? findAgentById('planner', allAgents)!
  const { systemPrompt, tools, hash, compactionFloor } = await buildCachedPrompt(sessionManager, sessionId, agentDef)

  sessionManager.setCachedPrompt(sessionId, systemPrompt, tools, hash, compactionFloor)
  sessionManager.setDynamicContextChanged(sessionId, false)
  sessionManager.clearDebugDump(sessionId)
  logger.debug('applyDynamicContext done', { sessionId, hash, toolCount: tools.length })
}
