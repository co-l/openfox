/**
 * Agent API Endpoint Tests
 *
 * Tests the /api/agents CRUD endpoints using a minimal express app
 * backed by a temp directory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer, type Server } from 'node:http'
import type { AgentDefinition } from './types.js'
import {
  loadAllAgents,
  findAgentById,
  saveAgent,
  deleteAgent,
  agentExists,
} from './registry.js'

let tempDir: string
let server: Server
let baseUrl: string

function mountAgentRoutes(app: express.Express, configDir: string) {
  app.use(express.json())

  app.get('/api/agents', async (_req, res) => {
    const agents = await loadAllAgents(configDir)
    res.json({ agents: agents.map(a => a.metadata) })
  })

  app.get('/api/agents/:id', async (req, res) => {
    const { id } = req.params
    const agents = await loadAllAgents(configDir)
    const agent = findAgentById(id as string, agents)
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' })
    }
    res.json(agent)
  })

  app.post('/api/agents', async (req, res) => {
    const body = req.body as AgentDefinition
    if (!body?.metadata?.id || !body?.prompt) {
      return res.status(400).json({ error: 'Missing required fields: metadata.id, prompt' })
    }
    if (await agentExists(configDir, body.metadata.id)) {
      return res.status(409).json({ error: 'An agent with this ID already exists' })
    }
    await saveAgent(configDir, body)
    res.status(201).json(body)
  })

  app.put('/api/agents/:id', async (req, res) => {
    const { id } = req.params
    if (!id) {
      return res.status(400).json({ error: 'Missing agent ID' })
    }
    const body = req.body as Partial<AgentDefinition>
    const agents = await loadAllAgents(configDir)
    const existing = findAgentById(id as string, agents)
    if (!existing) {
      return res.status(404).json({ error: 'Agent not found' })
    }
    const updated: AgentDefinition = {
      metadata: { ...existing.metadata, ...body.metadata, id: id as string },
      prompt: body.prompt ?? existing.prompt,
    }
    await saveAgent(configDir, updated)
    res.json(updated)
  })

  app.delete('/api/agents/:id', async (req, res) => {
    const { id } = req.params
    const result = await deleteAgent(configDir, id as string)
    if (!result.success) {
      return res.status(result.reason?.includes('Cannot delete built-in defaults') ? 403 : 404).json({ error: result.reason ?? 'Agent not found' })
    }
    res.json({ success: true })
  })
}

async function request(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const options: RequestInit = { method, headers: body ? { 'Content-Type': 'application/json' } : {} }
  if (body) options.body = JSON.stringify(body)
  const res = await fetch(`${baseUrl}${path}`, options)
  const json = await res.json()
  return { status: res.status, json }
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'agent-api-test-'))

  const app = express()
  mountAgentRoutes(app, tempDir)

  await new Promise<void>((resolve) => {
    server = createServer(app).listen(0, '127.0.0.1', resolve)
  })

  const addr = server.address()
  if (typeof addr === 'object' && addr) {
    baseUrl = `http://127.0.0.1:${addr.port}`
  }
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(tempDir, { recursive: true, force: true })
})

describe('GET /api/agents', () => {
  it('returns list of all agent metadata', async () => {
    const { status, json } = await request('GET', '/api/agents')
    const data = json as { agents: Array<{ id: string }> }

    expect(status).toBe(200)
    expect(data.agents.length).toBeGreaterThanOrEqual(5)

    const ids = data.agents.map(a => a.id)
    expect(ids).toContain('planner')
    expect(ids).toContain('builder')
    expect(ids).toContain('verifier')
  })
})

describe('GET /api/agents/:id', () => {
  it('returns full agent definition', async () => {
    const { status, json } = await request('GET', '/api/agents/verifier')
    const data = json as AgentDefinition

    expect(status).toBe(200)
    expect(data.metadata.id).toBe('verifier')
    expect(data.metadata.subagent).toBe(true)
    expect(data.prompt).toContain('independent verification')
  })

  it('returns 404 for unknown agent', async () => {
    const { status, json } = await request('GET', '/api/agents/nonexistent')

    expect(status).toBe(404)
    expect((json as any).error).toContain('not found')
  })
})

describe('POST /api/agents', () => {
  it('creates a new agent', async () => {
    const newAgent: AgentDefinition = {
      metadata: {
        id: 'security_auditor',
        name: 'Security Auditor',
        description: 'Audits code for vulnerabilities',
        subagent: true,
        allowedTools: ['read_file', 'grep'],
      },
      prompt: 'Audit the code for OWASP top 10.',
    }

    const { status, json } = await request('POST', '/api/agents', newAgent)

    expect(status).toBe(201)
    expect((json as any).metadata.id).toBe('security_auditor')

    const { status: getStatus, json: getJson } = await request('GET', '/api/agents/security_auditor')
    expect(getStatus).toBe(200)
    expect((getJson as AgentDefinition).prompt).toContain('OWASP')
  })

  it('returns 400 for missing fields', async () => {
    const { status } = await request('POST', '/api/agents', { metadata: {} })
    expect(status).toBe(400)
  })

  it('returns 409 for duplicate ID', async () => {
    const agent: AgentDefinition = {
      metadata: { id: 'test_dup', name: 'Dup', description: '', subagent: true, allowedTools: [] },
      prompt: 'Test.',
    }
    await request('POST', '/api/agents', agent)
    const { status } = await request('POST', '/api/agents', agent)
    expect(status).toBe(409)
  })
})

describe('PUT /api/agents/:id', () => {
  it('updates an existing agent', async () => {
    const agent: AgentDefinition = {
      metadata: { id: 'updatable', name: 'Original', description: 'V1', subagent: true, allowedTools: ['read_file'] },
      prompt: 'Original prompt.',
    }
    await request('POST', '/api/agents', agent)

    const { status, json } = await request('PUT', '/api/agents/updatable', {
      metadata: { name: 'Updated' },
      prompt: 'Updated prompt.',
    })

    expect(status).toBe(200)
    expect((json as AgentDefinition).metadata.name).toBe('Updated')
    expect((json as AgentDefinition).prompt).toBe('Updated prompt.')
    expect((json as AgentDefinition).metadata.id).toBe('updatable')
  })

  it('returns 404 for unknown agent', async () => {
    const { status } = await request('PUT', '/api/agents/nonexistent', { prompt: 'x' })
    expect(status).toBe(404)
  })
})

describe('DELETE /api/agents/:id', () => {
  it('deletes an existing agent', async () => {
    const agent: AgentDefinition = {
      metadata: { id: 'deleteme', name: 'Del', description: '', subagent: true, allowedTools: [] },
      prompt: 'Gone.',
    }
    await request('POST', '/api/agents', agent)

    const { status } = await request('DELETE', '/api/agents/deleteme')
    expect(status).toBe(200)

    const { status: getStatus } = await request('GET', '/api/agents/deleteme')
    expect(getStatus).toBe(404)
  })

  it('returns 404 for unknown agent', async () => {
    const { status } = await request('DELETE', '/api/agents/nonexistent')
    expect(status).toBe(404)
  })

  it('returns 403 for built-in default agents', async () => {
    const { status } = await request('DELETE', '/api/agents/verifier')
    expect(status).toBe(403)
  })
})