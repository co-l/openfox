/**
 * Agent Registry
 *
 * Discovers, loads, and manages agent definitions from .agent.md files.
 * Defaults are loaded from bundled defaults/ and are never copied to user config.
 * User items override defaults by ID.
 */

import { readdir, readFile, writeFile, mkdir, access, unlink } from 'node:fs/promises'
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
    allowedTools: Array.isArray(meta['allowedTools']) ? meta['allowedTools'].map(String) : [],
    ...(typeof meta['color'] === 'string' ? { color: meta['color'] } : {}),
    ...(Array.isArray(meta['results']) ? { results: meta['results'].map(String) } : {}),
  }

  return { metadata, prompt: content.trim() }
}

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

export async function loadDefaultAgents(): Promise<AgentDefinition[]> {
  const agents = await loadAgentsFromDir(DEFAULTS_DIR)
  if (agents.length > 0) return agents
  return loadAgentsFromDir(DEFAULTS_DIR_ALT)
}

export async function loadUserAgents(configDir: string): Promise<AgentDefinition[]> {
  return loadAgentsFromDir(getAgentsDir(configDir))
}

export async function loadAllAgents(configDir: string): Promise<AgentDefinition[]> {
  const [defaultAgents, userAgents] = await Promise.all([
    loadDefaultAgents(),
    loadUserAgents(configDir),
  ])

  const agentMap = new Map<string, AgentDefinition>()
  for (const agent of defaultAgents) {
    agentMap.set(agent.metadata.id, agent)
  }
  for (const agent of userAgents) {
    agentMap.set(agent.metadata.id, agent)
  }

  return Array.from(agentMap.values())
}

export async function loadAllAgentsDefault(): Promise<AgentDefinition[]> {
  try {
    const configDir = getGlobalConfigDir(getRuntimeConfig().mode ?? 'production')
    return await loadAllAgents(configDir)
  } catch {
    return loadDefaultAgents()
  }
}

export async function getDefaultAgentIds(): Promise<string[]> {
  for (const dir of [DEFAULTS_DIR, DEFAULTS_DIR_ALT]) {
    try {
      const files = (await readdir(dir)).filter(f => f.endsWith(AGENT_EXTENSION))
      return files.map(f => f.replace(AGENT_EXTENSION, ''))
    } catch { /* try next */ }
  }
  return []
}

export async function getDefaultAgentContent(agentId: string): Promise<AgentDefinition | null> {
  const defaults = await loadDefaultAgents()
  return defaults.find(a => a.metadata.id === agentId) ?? null
}

export async function isDefaultAgent(agentId: string): Promise<boolean> {
  const defaultIds = await getDefaultAgentIds()
  return defaultIds.includes(agentId)
}

function getAgentFilePaths(agentsDir: string, agentId: string): string[] {
  const hyphenated = agentId.replace(/_/g, '-')
  return [
    join(agentsDir, `${agentId}${AGENT_EXTENSION}`),
    join(agentsDir, `${hyphenated}${AGENT_EXTENSION}`),
  ]
}

export function findAgentById(agentId: string, agents: AgentDefinition[]): AgentDefinition | undefined {
  return agents.find(a => a.metadata.id === agentId)
}

export function getSubAgents(agents: AgentDefinition[]): AgentDefinition[] {
  return agents.filter(a => a.metadata.subagent)
}

export function getTopLevelAgents(agents: AgentDefinition[]): AgentDefinition[] {
  return agents.filter(a => !a.metadata.subagent)
}

export async function agentExists(configDir: string, agentId: string): Promise<boolean> {
  const agentsDir = getAgentsDir(configDir)
  const paths = getAgentFilePaths(agentsDir, agentId)
  for (const filePath of paths) {
    if (await pathExists(filePath)) {
      return true
    }
  }
  return false
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

export async function deleteAgent(configDir: string, agentId: string): Promise<{ success: boolean; reason?: string }> {
  const isDefault = await isDefaultAgent(agentId)
  if (isDefault) {
    return { success: false, reason: 'Cannot delete built-in defaults' }
  }
  const agentsDir = getAgentsDir(configDir)
  const paths = getAgentFilePaths(agentsDir, agentId)
  for (const filePath of paths) {
    try {
      await unlink(filePath)
      return { success: true }
    } catch {
      continue
    }
  }
  return { success: false }
}

export async function getOverrideAgentIds(configDir: string): Promise<string[]> {
  const [defaultIds, userAgents] = await Promise.all([
    getDefaultAgentIds(),
    loadUserAgents(configDir),
  ])
  return userAgents
    .map(agent => agent.metadata.id)
    .filter(id => defaultIds.includes(id))
}