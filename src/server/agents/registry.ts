/**
 * Agent Registry
 *
 * Discovers, loads, and manages agent definitions from .agent.md files.
 * Follows the same pattern as commands and skills registries.
 *
 * Built-in agents ship in src/server/agents/defaults/.
 * User agents live in ~/.openfox/agents/.
 * User definitions override built-in by id.
 */

import { readdir, readFile, writeFile, copyFile, mkdir, access, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import type { AgentDefinition, AgentMetadata } from './types.js'
import { logger } from '../utils/logger.js'
import { getRuntimeConfig } from '../runtime-config.js'
import { getGlobalConfigDir } from '../../cli/paths.js'

const __bundleDir = dirname(fileURLToPath(import.meta.url))
const DEFAULTS_DIR = join(__bundleDir, 'defaults')
const DEFAULTS_DIR_ALT = join(__bundleDir, 'agent-defaults')
const AGENT_EXTENSION = '.agent.md'

// ============================================================================
// Directory Helpers
// ============================================================================

function getAgentsDir(configDir: string): string {
  return join(configDir, 'agents')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

// ============================================================================
// Default Agents Installation
// ============================================================================

export async function ensureDefaultAgents(configDir: string): Promise<void> {
  const agentsDir = getAgentsDir(configDir)

  if (!await pathExists(agentsDir)) {
    await mkdir(agentsDir, { recursive: true })
  }

  let defaultFiles: string[]
  let sourceDir: string
  try {
    defaultFiles = (await readdir(DEFAULTS_DIR)).filter(f => f.endsWith(AGENT_EXTENSION))
    sourceDir = DEFAULTS_DIR
  } catch {
    try {
      defaultFiles = (await readdir(DEFAULTS_DIR_ALT)).filter(f => f.endsWith(AGENT_EXTENSION))
      sourceDir = DEFAULTS_DIR_ALT
    } catch {
      logger.warn('No bundled agent defaults found', { dir: DEFAULTS_DIR })
      return
    }
  }

  for (const file of defaultFiles) {
    const targetPath = join(agentsDir, file)
    if (!await pathExists(targetPath)) {
      try {
        await copyFile(join(sourceDir, file), targetPath)
        logger.info('Installed default agent', { file })
      } catch (err) {
        logger.error('Failed to copy default agent', { file, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }
}

// ============================================================================
// Parsing
// ============================================================================

function parseAgentFile(raw: string, filename: string): AgentDefinition | undefined {
  const { data, content } = matter(raw)
  const meta = data as Record<string, unknown>

  if (!meta['id'] || !content.trim()) {
    logger.warn('Skipping invalid agent file', { filename })
    return undefined
  }

  const metadata: AgentMetadata = {
    id: String(meta['id']),
    name: String(meta['name'] ?? meta['id']),
    description: String(meta['description'] ?? ''),
    subagent: meta['subagent'] === true,
    tools: Array.isArray(meta['tools']) ? meta['tools'].map(String) : [],
    ...(typeof meta['color'] === 'string' ? { color: meta['color'] } : {}),
  }

  return { metadata, prompt: content.trim() }
}

// ============================================================================
// Loading
// ============================================================================

async function loadAgentsFromDir(dir: string): Promise<AgentDefinition[]> {
  if (!await pathExists(dir)) {
    return []
  }

  let files: string[]
  try {
    files = (await readdir(dir)).filter(f => f.endsWith(AGENT_EXTENSION))
  } catch {
    return []
  }

  const agents: AgentDefinition[] = []
  for (const file of files) {
    try {
      const raw = await readFile(join(dir, file), 'utf-8')
      const agent = parseAgentFile(raw, file)
      if (agent) {
        agents.push(agent)
      }
    } catch (err) {
      logger.warn('Failed to parse agent file', { file, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return agents
}

/**
 * Load all agents from both built-in defaults and user config.
 * User definitions override built-in by id.
 */
export async function loadAllAgents(configDir: string): Promise<AgentDefinition[]> {
  const [builtinAgents, userAgents] = await Promise.all([
    loadBuiltinAgents(),
    loadAgentsFromDir(getAgentsDir(configDir)),
  ])

  const agentMap = new Map<string, AgentDefinition>()
  for (const agent of builtinAgents) {
    agentMap.set(agent.metadata.id, agent)
  }
  for (const agent of userAgents) {
    agentMap.set(agent.metadata.id, agent)
  }

  return Array.from(agentMap.values())
}

/**
 * Load all agents using the global config directory.
 * Convenience wrapper that resolves configDir from runtime config.
 * Use this from code that doesn't have configDir readily available.
 */
export async function loadAllAgentsDefault(): Promise<AgentDefinition[]> {
  try {
    const configDir = getGlobalConfigDir(getRuntimeConfig().mode ?? 'production')
    return await loadAllAgents(configDir)
  } catch {
    return loadBuiltinAgents()
  }
}

/**
 * Load only built-in agents (from the bundled defaults directory).
 */
export async function loadBuiltinAgents(): Promise<AgentDefinition[]> {
  const agents = await loadAgentsFromDir(DEFAULTS_DIR)
  if (agents.length > 0) return agents
  return loadAgentsFromDir(DEFAULTS_DIR_ALT)
}

// ============================================================================
// Lookup Helpers
// ============================================================================

export function findAgentById(agentId: string, agents: AgentDefinition[]): AgentDefinition | undefined {
  return agents.find(a => a.metadata.id === agentId)
}

export function getSubAgents(agents: AgentDefinition[]): AgentDefinition[] {
  return agents.filter(a => a.metadata.subagent)
}

export function getTopLevelAgents(agents: AgentDefinition[]): AgentDefinition[] {
  return agents.filter(a => !a.metadata.subagent)
}

// ============================================================================
// CRUD
// ============================================================================

export async function agentExists(configDir: string, agentId: string): Promise<boolean> {
  const filePath = join(getAgentsDir(configDir), `${agentId}${AGENT_EXTENSION}`)
  return pathExists(filePath)
}

export async function saveAgent(configDir: string, agent: AgentDefinition): Promise<void> {
  const agentsDir = getAgentsDir(configDir)
  if (!await pathExists(agentsDir)) {
    await mkdir(agentsDir, { recursive: true })
  }
  const filePath = join(agentsDir, `${agent.metadata.id}${AGENT_EXTENSION}`)
  const content = matter.stringify(agent.prompt, agent.metadata)
  await writeFile(filePath, content, 'utf-8')
}

export async function deleteAgent(configDir: string, agentId: string): Promise<boolean> {
  const filePath = join(getAgentsDir(configDir), `${agentId}${AGENT_EXTENSION}`)
  try {
    await unlink(filePath)
    return true
  } catch {
    return false
  }
}
