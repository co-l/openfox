/**
 * WebSocket Protocol E2E Tests
 * 
 * Tests basic WebSocket communication, message format, and error handling.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createTestClient, createTestProject, createTestServer, createProject, createSession, type TestClient, type TestProject, type TestServerHandle } from './utils/index.js'

describe('WebSocket Protocol', () => {
  let server: TestServerHandle
  let client: TestClient
  let project: TestProject

  beforeAll(async () => {
    server = await createTestServer()
  })

  afterAll(async () => {
    await server.close()
  })

  beforeEach(async () => {
    client = await createTestClient({ url: server.wsUrl })
    project = await createTestProject({ template: 'typescript' })
  })

  afterEach(async () => {
    await client.close()
    await project.cleanup()
  })

  describe('Connection', () => {
    it('establishes WebSocket connection', () => {
      expect(client.isConnected()).toBe(true)
    })
  })

  describe('Message Correlation', () => {
    it('returns responses with matching correlation ID', async () => {
      const restProject = await createProject(server.url, { name: 'test', workdir: project.path })
      const restSession = await createSession(server.url, { projectId: restProject.id })
      await client.send('session.load', { sessionId: restSession.id })
      
      const response = await client.send('chat.send', { content: 'Hello' })
      expect(response.id).toBeDefined()
      expect(response.type).toBe('ack')
    })

    it('handles multiple concurrent requests', async () => {
      const restProject = await createProject(server.url, { name: 'test', workdir: project.path })
      const restSession = await createSession(server.url, { projectId: restProject.id })
      await client.send('session.load', { sessionId: restSession.id })
      
      const response1 = client.send('chat.send', { content: 'First' })
      const response2 = client.send('context.compact', {})
      
      const [r1, r2] = await Promise.all([response1, response2])

      expect(r1.type).toBe('ack')
      expect(r2.type).toBe('error')
    })
  })

  describe('Error Handling', () => {
    it('returns error for unknown message type', async () => {
      const restProject = await createProject(server.url, { name: 'test', workdir: project.path })
      const restSession = await createSession(server.url, { projectId: restProject.id })
      await client.send('session.load', { sessionId: restSession.id })
      
      const response = await client.send('unknown.type' as 'project.list', {})
      expect(response.type).toBe('error')
      expect((response.payload as { code: string }).code).toBe('UNKNOWN_MESSAGE')
    })



    it('returns error for operations without session', async () => {
      // Try to send chat without loading a session
      const response = await client.send('chat.send', { content: 'Hello' })
      expect(response.type).toBe('error')
      expect((response.payload as { code: string }).code).toBe('NO_SESSION')
    })

    it('returns NOT_FOUND for invalid session ID', async () => {
      const response = await client.send('session.load', { sessionId: 'nonexistent-id' })
      expect(response.type).toBe('error')
      expect((response.payload as { code: string }).code).toBe('NOT_FOUND')
    })
  })

  describe('Acknowledgments', () => {
    it('returns ack for chat.stop', async () => {
      const restProject = await createProject(server.url, { name: 'test', workdir: project.path })
      const restSession = await createSession(server.url, { projectId: restProject.id })
      await client.send('session.load', { sessionId: restSession.id })
      
      // Stop should return ack even if nothing is running
      const response = await client.send('chat.stop', {})
      expect(response.type).toBe('ack')
    })
  })

  describe('Session Loading', () => {
    it('provides full session state on load', async () => {
      const restProject = await createProject(server.url, { name: 'test', workdir: project.path })
      const restSession = await createSession(server.url, { projectId: restProject.id })
      await client.send('session.load', { sessionId: restSession.id })
      
      const session = client.getSession()
      expect(session).not.toBeNull()
      expect(session!.mode).toBe('planner')
      expect(session!.phase).toBe('plan')
      expect(session!.isRunning).toBe(false)
    })
  })
})
