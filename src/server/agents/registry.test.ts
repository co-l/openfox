/**
 * Agent Registry Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadAllAgents,
  loadDefaultAgents,
  findAgentById,
  getSubAgents,
  getTopLevelAgents,
  saveAgent,
  deleteAgent,
  isDefaultAgent,
  getDefaultAgentIds,
} from './registry.js'
import type { AgentDefinition } from './types.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'agent-registry-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('loadDefaultAgents', () => {
  it('should load all built-in agent definitions', async () => {
    const agents = await loadDefaultAgents()

    expect(agents.length).toBeGreaterThanOrEqual(5)

    const ids = agents.map(a => a.metadata.id)
    expect(ids).toContain('planner')
    expect(ids).toContain('builder')
    expect(ids).toContain('verifier')
    expect(ids).toContain('code_reviewer')
    expect(ids).toContain('explorer')
  })

  it('should parse agent metadata correctly', async () => {
    const agents = await loadDefaultAgents()
    const verifier = agents.find(a => a.metadata.id === 'verifier')!

    expect(verifier.metadata.name).toBe('Verifier')
    expect(verifier.metadata.description).toBe('Verifies completed criteria against actual code changes')
    expect(verifier.metadata.subagent).toBe(true)
    expect(verifier.metadata.allowedTools).toEqual(['read_file', 'run_command', 'criterion:pass,fail', 'web_fetch'])
    expect(verifier.prompt).toContain('independent verification')
  })

  it('should distinguish subagent vs top-level agents', async () => {
    const agents = await loadDefaultAgents()
    const planner = agents.find(a => a.metadata.id === 'planner')!
    const builder = agents.find(a => a.metadata.id === 'builder')!
    const verifier = agents.find(a => a.metadata.id === 'verifier')!

    expect(planner.metadata.subagent).toBe(false)
    expect(builder.metadata.subagent).toBe(false)
    expect(verifier.metadata.subagent).toBe(true)
  })
})

describe('loadAllAgents', () => {
  it('should merge built-in and user agents, with user overriding by id', async () => {
    const agentsDir = join(tempDir, 'agents')
    await mkdir(agentsDir, { recursive: true })
    await writeFile(join(agentsDir, 'verifier.agent.md'), `---
id: verifier
name: Custom Verifier
description: My custom verifier
subagent: true
tools:
  - read_file
  - pass_criterion
---

Custom verifier instructions.
`)

    const agents = await loadAllAgents(tempDir)
    const verifier = agents.find(a => a.metadata.id === 'verifier')!

    expect(verifier.metadata.name).toBe('Custom Verifier')
    expect(verifier.prompt).toBe('Custom verifier instructions.')
  })

  it('should include user-defined agents alongside built-in', async () => {
    const agentsDir = join(tempDir, 'agents')
    await mkdir(agentsDir, { recursive: true })
    await writeFile(join(agentsDir, 'security-auditor.agent.md'), `---
id: security_auditor
name: Security Auditor
description: Audit code for security issues
subagent: true
tools:
  - read_file
  - grep
---

Audit the code for OWASP top 10 vulnerabilities.
`)

    const agents = await loadAllAgents(tempDir)
    const auditor = agents.find(a => a.metadata.id === 'security_auditor')

    expect(auditor).toBeDefined()
    expect(auditor!.metadata.name).toBe('Security Auditor')
    expect(auditor!.metadata.subagent).toBe(true)
  })
})

describe('filter helpers', () => {
  it('should separate subagents from top-level agents', async () => {
    const agents = await loadDefaultAgents()
    const subs = getSubAgents(agents)
    const topLevel = getTopLevelAgents(agents)

    expect(subs.every(a => a.metadata.subagent)).toBe(true)
    expect(topLevel.every(a => !a.metadata.subagent)).toBe(true)
    expect(subs.length + topLevel.length).toBe(agents.length)
  })

  it('findAgentById returns correct agent', async () => {
    const agents = await loadDefaultAgents()
    const explorer = findAgentById('explorer', agents)
    expect(explorer).toBeDefined()
    expect(explorer!.metadata.name).toBe('Explorer')

    expect(findAgentById('nonexistent', agents)).toBeUndefined()
  })
})

describe('CRUD', () => {
  it('should save and load a user agent', async () => {
    const agent: AgentDefinition = {
      metadata: {
        id: 'my_agent',
        name: 'My Agent',
        description: 'Test agent',
        subagent: true,
        allowedTools: ['read_file'],
      },
      prompt: 'Do the thing.',
    }

    await saveAgent(tempDir, agent)
    const agents = await loadAllAgents(tempDir)
    const loaded = agents.find(a => a.metadata.id === 'my_agent')

    expect(loaded).toBeDefined()
    expect(loaded!.metadata.name).toBe('My Agent')
    expect(loaded!.prompt).toBe('Do the thing.')
  })

  it('should delete a user agent', async () => {
    const agent: AgentDefinition = {
      metadata: {
        id: 'deleteme',
        name: 'Delete Me',
        description: 'To be deleted',
        subagent: false,
        allowedTools: [],
      },
      prompt: 'Temporary.',
    }

    await saveAgent(tempDir, agent)
    const result = await deleteAgent(tempDir, 'deleteme')
    expect(result.success).toBe(true)

    const agents = await loadAllAgents(tempDir)
    expect(agents.find(a => a.metadata.id === 'deleteme')).toBeUndefined()
  })

  it('should not delete built-in default agents', async () => {
    const result = await deleteAgent(tempDir, 'verifier')
    expect(result.success).toBe(false)
    expect(result.reason).toBe('Cannot delete built-in defaults')
  })

  it('should return false when deleting non-existent agent', async () => {
    const result = await deleteAgent(tempDir, 'nonexistent')
    expect(result.success).toBe(false)
  })
})

describe('isDefaultAgent', () => {
  it('should correctly identify built-in default agents', async () => {
    const isPlannerDefault = await isDefaultAgent('planner')
    const isBuilderDefault = await isDefaultAgent('builder')
    const isVerifierDefault = await isDefaultAgent('verifier')
    const isNonExistentDefault = await isDefaultAgent('nonexistent')

    expect(isPlannerDefault).toBe(true)
    expect(isBuilderDefault).toBe(true)
    expect(isVerifierDefault).toBe(true)
    expect(isNonExistentDefault).toBe(false)
  })
})

describe('getDefaultAgentIds', () => {
  it('should return all default agent IDs', async () => {
    const ids = await getDefaultAgentIds()

    expect(ids).toContain('planner')
    expect(ids).toContain('builder')
    expect(ids).toContain('verifier')
    expect(ids).toContain('explorer')
    expect(ids).toContain('code-reviewer')
  })
})