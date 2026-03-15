/**
 * WebSocket Protocol E2E Tests
 * 
 * Tests basic WebSocket communication, message format, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestClient, createTestProject, type TestClient, type TestProject } from './utils/index.js'

describe('WebSocket Protocol', () => {
  let client: TestClient
  let project: TestProject

  beforeEach(async () => {
    client = await createTestClient()
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
      const response = await client.send('project.list', {})
      expect(response.id).toBeDefined()
      expect(response.type).toBe('project.list')
    })

    it('handles multiple concurrent requests', async () => {
      // Send multiple requests in parallel
      const [r1, r2, r3] = await Promise.all([
        client.send('project.list', {}),
        client.send('settings.get', { key: 'test-key' }),
        client.send('project.list', {}),
      ])

      expect(r1.type).toBe('project.list')
      expect(r2.type).toBe('settings.value')
      expect(r3.type).toBe('project.list')
    })
  })

  describe('Error Handling', () => {
    it('returns error for invalid payload', async () => {
      // Send project.create with missing required fields
      const response = await client.send('project.create', {})
      expect(response.type).toBe('error')
      expect((response.payload as { code: string }).code).toBe('INVALID_PAYLOAD')
    })

    it('returns error for unknown message type', async () => {
      // Use type assertion to test invalid message type
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

    it('returns NOT_FOUND for invalid project ID', async () => {
      const response = await client.send('project.load', { projectId: 'nonexistent-id' })
      expect(response.type).toBe('error')
      expect((response.payload as { code: string }).code).toBe('NOT_FOUND')
    })

    it('returns NOT_FOUND for invalid session ID', async () => {
      const response = await client.send('session.load', { sessionId: 'nonexistent-id' })
      expect(response.type).toBe('error')
      expect((response.payload as { code: string }).code).toBe('NOT_FOUND')
    })
  })

  describe('Acknowledgments', () => {
    it('returns ack for chat.stop', async () => {
      // First create a project and session
      await client.send('project.create', { name: 'test', workdir: project.path })
      const projectState = client.getProject()
      expect(projectState).not.toBeNull()
      
      await client.send('session.create', { projectId: projectState!.id })
      
      // Stop should return ack even if nothing is running
      const response = await client.send('chat.stop', {})
      expect(response.type).toBe('ack')
    })
  })

  describe('Session Loading', () => {
    it('provides full session state on load', async () => {
      // Create project and session
      await client.send('project.create', { name: 'test', workdir: project.path })
      const projectState = client.getProject()!
      
      const response = await client.send('session.create', { projectId: projectState.id })
      expect(response.type).toBe('session.state')
      
      const session = client.getSession()
      expect(session).not.toBeNull()
      expect(session!.mode).toBe('planner')
      expect(session!.phase).toBe('plan')
      expect(session!.isRunning).toBe(false)
    })
  })
})
