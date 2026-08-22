/**
 * Team Routes Tests
 *
 * In-memory DB integration: CRUD for teams + workflow->team binding.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import { type Server } from 'node:http'
import { closeDatabase, initDatabase } from '../db/index.js'
import { loadConfig } from '../config.js'
import { getTeam, getWorkflowTeam } from '../agents/teams.js'
import { createTeamRoutes } from './teams.js'

describe('Team routes', () => {
  let server: Server
  let baseUrl: string

  beforeEach(async () => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)

    const app = express()
    app.use(express.json())
    app.use('/api/teams', createTeamRoutes())

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as { port: number }).port}`
        resolve()
      })
    })
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    closeDatabase()
  })

  it('lists an empty team map initially', async () => {
    const res = await fetch(`${baseUrl}/api/teams`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ teams: {} })
  })

  it('creates and retrieves a team', async () => {
    const create = await fetch(`${baseUrl}/api/teams/team-a`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Team A',
        assignments: {
          build: { providerId: 'p1', model: 'm1' },
          verify: { providerId: 'p2', model: 'm2', reasoningEffort: 'high' },
        },
      }),
    })
    expect(create.status).toBe(200)
    const team = (await create.json()) as { id: string; name: string }
    expect(team.id).toBe('team-a')
    expect(team.name).toBe('Team A')

    const res = await fetch(`${baseUrl}/api/teams/team-a`)
    expect(res.status).toBe(200)
    expect(getTeam('team-a')?.assignments['build']).toEqual({ providerId: 'p1', model: 'm1' })
  })

  it('rejects a team with an invalid reasoningEffort', async () => {
    const res = await fetch(`${baseUrl}/api/teams/bad`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad',
        assignments: { build: { providerId: 'p1', model: 'm1', reasoningEffort: 'nope' } },
      }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects a team missing a name', async () => {
    const res = await fetch(`${baseUrl}/api/teams/bad`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments: {} }),
    })
    expect(res.status).toBe(400)
  })

  it('deletes a team', async () => {
    await fetch(`${baseUrl}/api/teams/team-a`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Team A', assignments: {} }),
    })
    const res = await fetch(`${baseUrl}/api/teams/team-a`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(getTeam('team-a')).toBeUndefined()
  })

  it('sets and reads a workflow->team binding', async () => {
    await fetch(`${baseUrl}/api/teams/team-a`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Team A', assignments: {} }),
    })

    const bind = await fetch(`${baseUrl}/api/teams/bindings/wf`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: 'team-a' }),
    })
    expect(bind.status).toBe(200)
    expect(getWorkflowTeam('wf')).toBe('team-a')

    const read = await fetch(`${baseUrl}/api/teams/bindings/wf`)
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual({ teamId: 'team-a' })
  })

  it('rejects a binding to a non-existent team', async () => {
    const res = await fetch(`${baseUrl}/api/teams/bindings/wf`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: 'ghost' }),
    })
    expect(res.status).toBe(404)
  })

  it('clears a workflow->team binding', async () => {
    await fetch(`${baseUrl}/api/teams/team-a`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Team A', assignments: {} }),
    })
    await fetch(`${baseUrl}/api/teams/bindings/wf`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: 'team-a' }),
    })

    const res = await fetch(`${baseUrl}/api/teams/bindings/wf`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(getWorkflowTeam('wf')).toBeUndefined()
  })
})
