/**
 * Verifier Mode E2E Tests
 * 
 * Tests the verification sub-agent that runs after builder completes criteria.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { 
  createTestClient, 
  createTestProject,
  createTestServer,
  collectUntilPhase,
  assertNoErrors,
  createProject,
  createSession,
  type TestClient, 
  type TestProject,
  type TestServerHandle 
} from './utils/index.js'
import type { Message } from '@openfox/shared'

describe('Verifier Mode', () => {
  let server: TestServerHandle
  let client: TestClient
  let testDir: TestProject

  beforeAll(async () => {
    server = await createTestServer()
  })

  afterAll(async () => {
    await server.close()
  })

  beforeEach(async () => {
    client = await createTestClient({ url: server.wsUrl })
    testDir = await createTestProject({ template: 'typescript' })
    
    const restProject = await createProject(server.url, { name: 'Verifier Test', workdir: testDir.path })
    const restSession = await createSession(server.url, { projectId: restProject.id })
    await client.send('session.load', { sessionId: restSession.id })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('Verification Triggering', () => {
    it('triggers verification after builder completes criterion', async () => {
      await client.send('chat.send', {
        content: 'Add criterion ID "trivial-pass": "Trivial pass criterion". Use add_criterion.',
      })
      await client.waitForChatDone()
      await client.send('mode.switch', { mode: 'builder' })
      await client.send('runner.launch', {})

      const events = await collectUntilPhase(client, 'verification', 1_500)
      const verificationPhase = events.get('phase.changed').find(e => {
        return (e.payload as { phase: string }).phase === 'verification'
      })
      expect(verificationPhase).toBeDefined()
    })
  })

  describe('Fresh Context', () => {
    it('verifier uses fresh context with summary', async () => {
      await client.send('chat.send', {
        content: 'Add criterion ID "trivial-pass": "Trivial pass criterion". Use add_criterion.',
      })
      await client.waitForChatDone()
      await client.send('mode.switch', { mode: 'builder' })
      await client.send('runner.launch', {})

      await collectUntilPhase(client, 'done', 1_500)
      
      // Check for context-reset message
      const events = client.allEvents()
      const contextResetMsg = events.find(e => {
        if (e.type !== 'chat.message') return false
        const payload = e.payload as { message: Message }
        return payload.message.messageKind === 'context-reset'
      })
      
      // Verifier should create context-reset message
      expect(contextResetMsg).toBeDefined()
      const payload = contextResetMsg!.payload as { message: Message }
      expect(payload.message.subAgentType).toBe('verifier')
    })
  })

  describe('Sub-Agent Messages', () => {
    it('marks verifier messages with subAgentId', async () => {
      await client.send('chat.send', {
        content: 'Add criterion ID "trivial-pass": "Trivial pass criterion". Use add_criterion.',
      })
      await client.waitForChatDone()
      await client.send('mode.switch', { mode: 'builder' })
      await client.send('runner.launch', {})

      await collectUntilPhase(client, 'done', 1_500)
      
      // Check for verifier messages
      const events = client.allEvents()
      const verifierMessages = events.filter(e => {
        if (e.type !== 'chat.message') return false
        const payload = e.payload as { message: Message }
        return payload.message.subAgentType === 'verifier'
      })
      
      // If verification ran, should have verifier messages
      expect(verifierMessages.length).toBeGreaterThan(0)
      const msg = verifierMessages[0]!.payload as { message: Message }
      expect(msg.message.subAgentId).toBeDefined()
    })
  })

  describe('Verification Tools', () => {
    describe('pass_criterion', () => {
      it('marks criterion as passed when verification succeeds', async () => {
        await client.send('chat.send', {
          content: 'Add criterion ID "trivial-pass": "Trivial pass criterion". Use add_criterion.',
        })
        await client.waitForChatDone()
        await client.send('mode.switch', { mode: 'builder' })
        await client.send('runner.launch', {})

        await collectUntilPhase(client, 'done', 1_500)
        
        const session = client.getSession()!
        const criterion = session.criteria[0]
        
        expect(session.phase).toBe('done')
        expect(criterion?.status.type).toBe('passed')
      })
    })

    describe('fail_criterion', () => {
      it('marks criterion as failed and returns to builder', { timeout: 20_000 }, async () => {
        await client.send('chat.send', {
          content: 'Add criterion ID "verify-fail": "Verifier should fail this criterion". Use add_criterion.',
        })
        await client.waitForChatDone()
        await client.send('mode.switch', { mode: 'builder' })
        await client.send('runner.launch', {})

        await collectUntilPhase(client, 'blocked', 15_000)
        
        // Check criteria status
        const session = client.getSession()!
        const criterion = session.criteria[0]
        
        // Either passed (builder created it) or failed (couldn't create)
        expect(criterion?.status.type).toBe('failed')
      })
    })
  })

  describe('Verification without Thinking', () => {
    it('verifier does not emit thinking content', async () => {
      await client.send('chat.send', {
        content: 'Add criterion ID "trivial-pass": "Trivial pass criterion". Use add_criterion.',
      })
      await client.waitForChatDone()
      await client.send('mode.switch', { mode: 'builder' })
      
      client.clearEvents()
      
      await client.send('runner.launch', {})
      
      await collectUntilPhase(client, 'done', 1_500)
      
      // Check events - verifier thinking should not be present
      const events = client.allEvents()
      const thinkingEvents = events.filter(e => e.type === 'chat.thinking')
      
      // If there are thinking events, they should be from builder, not verifier
      // (This is hard to verify without message correlation, but we just check it doesn't crash)
      assertNoErrors({ all: events, byType: new Map(), get: () => [], hasEvent: () => false, findEvent: () => undefined })
      expect(thinkingEvents.length).toBe(0)
    })
  })
})
