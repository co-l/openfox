import { createHash } from 'node:crypto'
import type { SkillMetadata } from '../skills/types.js'
import type { LLMToolDefinition } from '../llm/types.js'
import type { SessionManager } from '../session/manager.js'
import type { AgentDefinition } from '../agents/types.js'
import { getAllInstructions } from '../context/instructions.js'
import { getEnabledSkillMetadata } from '../skills/registry.js'
import { buildTopLevelSystemPrompt } from './prompts.js'
import { loadAllAgentsDefault, getSubAgents, findAgentById, resolveDefaultAgentId } from '../agents/registry.js'
import { getRuntimeConfig } from '../runtime-config.js'
import { getGlobalConfigDir } from '../../cli/paths.js'
import { logger } from '../utils/logger.js'

export interface DiffLine {
  type: 'unchanged' | 'added' | 'removed'
  content: string
}

/**
 * Compute unified diff between two texts.
 * Returns array of diff lines with type markers.
 */
export function computeUnifiedDiff(oldText: string, newText: string): DiffLine[] {
  // Handle empty strings - split by newline but filter out trailing empty string
  const oldLines = oldText.length === 0 ? [] : oldText.split('\n')
  const newLines = newText.length === 0 ? [] : newText.split('\n')
  const result: DiffLine[] = []

  // Quick check: if texts are identical, return all unchanged
  if (oldText === newText) {
    return oldLines.map((line) => ({ type: 'unchanged' as const, content: line }))
  }

  // Build LCS table using Map to avoid TypeScript indexing issues
  const lcs = new Map<number, Map<number, number>>()
  for (let i = 0; i <= oldLines.length; i++) {
    lcs.set(i, new Map())
    for (let j = 0; j <= newLines.length; j++) {
      lcs.get(i)!.set(j, 0)
    }
  }

  for (let i = 1; i <= oldLines.length; i++) {
    for (let j = 1; j <= newLines.length; j++) {
      const oldLine = oldLines[i - 1]
      const newLine = newLines[j - 1]
      if (oldLine === newLine) {
        lcs.get(i)!.set(j, (lcs.get(i - 1)!.get(j - 1) ?? 0) + 1)
      } else {
        const up = lcs.get(i - 1)!.get(j) ?? 0
        const left = lcs.get(i)!.get(j - 1) ?? 0
        lcs.get(i)!.set(j, Math.max(up, left))
      }
    }
  }

  // Backtrack to find diff
  let i = oldLines.length
  let j = newLines.length

  while (i > 0 || j > 0) {
    const oldLine = oldLines[i - 1] ?? ''
    const newLine = newLines[j - 1] ?? ''

    if (i > 0 && j > 0 && oldLine === newLine) {
      result.unshift({ type: 'unchanged', content: oldLine })
      i--
      j--
    } else if (i > 0 && j > 0) {
      const lcsIM1J = lcs.get(i - 1)?.get(j) ?? 0
      const lcsIJM1 = lcs.get(i)?.get(j - 1) ?? 0

      // Prefer removing old lines first, then adding new lines
      if (lcsIM1J > lcsIJM1) {
        result.unshift({ type: 'removed', content: oldLine })
        i--
      } else {
        result.unshift({ type: 'added', content: newLine })
        j--
      }
    } else if (i > 0) {
      result.unshift({ type: 'removed', content: oldLine })
      i--
    } else {
      result.unshift({ type: 'added', content: newLine })
      j--
    }
  }

  return result
}

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
    return findAgentById(session.mode, allAgents) ?? findAgentById(resolveDefaultAgentId(), allAgents)!
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
): Promise<{ systemPrompt: string; tools: LLMToolDefinition[]; hash: string }> {
  const { instructionContent, skills } = await loadSessionContext(sessionManager, sessionId)

  const { getToolRegistryForAgent } = await import('../tools/index.js')
  const tools = getToolRegistryForAgent(agentDef).definitions
  const toolFingerprint = getToolFingerprint(tools)

  const allAgents = await loadAllAgentsDefault()
  const subAgentDefs = getSubAgents(allAgents)
  const session = sessionManager.requireSession(sessionId)
  const systemPrompt = buildTopLevelSystemPrompt(session.workdir, instructionContent || undefined, skills, subAgentDefs)

  const hash = computeDynamicContextHash(instructionContent, skills, toolFingerprint)

  return { systemPrompt, tools, hash }
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
  const agentDef = findAgentById(session.mode, allAgents) ?? findAgentById(resolveDefaultAgentId(), allAgents)!
  const { systemPrompt, tools, hash } = await buildCachedPrompt(sessionManager, sessionId, agentDef)

  sessionManager.setCachedPrompt(sessionId, systemPrompt, tools, hash)
  sessionManager.setDynamicContextChanged(sessionId, false)
  sessionManager.clearDebugDump(sessionId)
  logger.debug('applyDynamicContext done', { sessionId, hash, toolCount: tools.length })
}
