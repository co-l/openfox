/**
 * Step Model Override Routes Tests
 *
 * In-memory DB integration: per-step (workflowId:stepId) model override CRUD.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import { type Server } from 'node:http'
import { closeDatabase, initDatabase } from '../db/index.js'
import { loadConfig } from '../config.js'
import { getStepModelOverride } from '../agents/model-overrides.js'
import { createStepModelOverrideRoutes } from './step-model-overrides.js'

describe('Step model override routes', () => {
  let server: Server
  let baseUrl: string

  beforeEach(async () => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)

    const app = express()
    app.use(express.json())
    app.use('/api/workflows', createStepModelOverrideRoutes())

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

  it('returns null when no step override is set', async () => {
    const res = await fetch(`${baseUrl}/api/workflows/wf/steps/verify/model`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ providerId: null, model: null, reasoningEffort: null })
  })

  it('sets and reads a step override', async () => {
    const put = await fetch(`${baseUrl}/api/workflows/wf/steps/verify/model`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'anthropic', model: 'claude-sonnet-5', reasoningEffort: 'high' }),
    })
    expect(put.status).toBe(200)
    expect(getStepModelOverride('wf', 'verify')).toEqual({
      providerId: 'anthropic',
      model: 'claude-sonnet-5',
      reasoningEffort: 'high',
    })

    const res = await fetch(`${baseUrl}/api/workflows/wf/steps/verify/model`)
    expect(await res.json()).toEqual({ providerId: 'anthropic', model: 'claude-sonnet-5', reasoningEffort: 'high' })
  })

  it('rejects an invalid reasoningEffort', async () => {
    const res = await fetch(`${baseUrl}/api/workflows/wf/steps/verify/model`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'p', model: 'm', reasoningEffort: 'nope' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects a partial override (missing model)', async () => {
    const res = await fetch(`${baseUrl}/api/workflows/wf/steps/verify/model`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'p' }),
    })
    expect(res.status).toBe(400)
  })

  it('clears a step override with an empty body', async () => {
    await fetch(`${baseUrl}/api/workflows/wf/steps/verify/model`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'p', model: 'm' }),
    })
    expect(getStepModelOverride('wf', 'verify')).toBeDefined()

    const res = await fetch(`${baseUrl}/api/workflows/wf/steps/verify/model`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    expect(getStepModelOverride('wf', 'verify')).toBeUndefined()
  })

  it('deletes a step override', async () => {
    await fetch(`${baseUrl}/api/workflows/wf/steps/verify/model`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'p', model: 'm' }),
    })
    const res = await fetch(`${baseUrl}/api/workflows/wf/steps/verify/model`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(getStepModelOverride('wf', 'verify')).toBeUndefined()
  })

  it('keeps overrides for different steps independent', async () => {
    await fetch(`${baseUrl}/api/workflows/wf/steps/build/model`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'p1', model: 'm1' }),
    })
    await fetch(`${baseUrl}/api/workflows/wf/steps/verify/model`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'p2', model: 'm2' }),
    })
    expect(getStepModelOverride('wf', 'build')?.model).toBe('m1')
    expect(getStepModelOverride('wf', 'verify')?.model).toBe('m2')
  })
})
