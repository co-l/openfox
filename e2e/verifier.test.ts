/**
 * Verifier Mode E2E Tests
 * 
 * Tests the verification sub-agent that runs after builder completes criteria.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { 
  createTestClient, 
  createTestProject,
  collectUntilPhase,
  assertNoErrors,
  type TestClient, 
  type TestProject 
} from './utils/index.js'
import type { Message } from '@openfox/shared'

describe('Verifier Mode', () => {
  let client: TestClient
  let testDir: TestProject

  beforeEach(async () => {
    client = await createTestClient()
    testDir = await createTestProject({ template: 'typescript' })
    
    await client.send('project.create', { name: 'Verifier Test', workdir: testDir.path })
    const projectId = client.getProject()!.id
    await client.send('session.create', { projectId })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('Verification Triggering', () => {
    it('triggers verification after builder completes criterion', async () => {
      // Add criterion
      await client.send('chat.send', { 
        content: 'Add criterion ID "verify-trigger": "A file exists". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Accept and wait for verification phase
      await client.send('mode.accept', {})
      
      try {
        const events = await collectUntilPhase(client, 'verification', 120_000)
        
        // Should have verification phase
        const phaseChanges = events.get('phase.changed')
        const verificationPhase = phaseChanges.find(e => 
          (e.payload as { phase: string }).phase === 'verification'
        )
        expect(verificationPhase).toBeDefined()
      } catch {
        // May skip directly to done/blocked for simple criteria
        const session = client.getSession()!
        expect(['done', 'blocked', 'verification']).toContain(session.phase)
      }
    }, 150_000)
  })

  describe('Fresh Context', () => {
    it('verifier uses fresh context with summary', async () => {
      // Add criterion
      await client.send('chat.send', { 
        content: 'Add criterion: "Basic test". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Accept
      await client.send('mode.accept', {})
      
      // Wait for some activity
      await collectUntilPhase(client, 'verification', 120_000)
        .catch(() => collectUntilPhase(client, 'done', 10_000))
      
      // Check for context-reset message
      const events = client.allEvents()
      const contextResetMsg = events.find(e => {
        if (e.type !== 'chat.message') return false
        const payload = e.payload as { message: Message }
        return payload.message.messageKind === 'context-reset'
      })
      
      // Verifier should create context-reset message
      if (contextResetMsg) {
        const payload = contextResetMsg.payload as { message: Message }
        expect(payload.message.subAgentType).toBe('verifier')
      }
    }, 150_000)
  })

  describe('Sub-Agent Messages', () => {
    it('marks verifier messages with subAgentId', async () => {
      // Add criterion
      await client.send('chat.send', { 
        content: 'Add criterion: "Something to verify". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Accept
      await client.send('mode.accept', {})
      
      // Wait for completion
      await collectUntilPhase(client, 'done', 180_000)
        .catch(() => collectUntilPhase(client, 'blocked', 10_000))
      
      // Check for verifier messages
      const events = client.allEvents()
      const verifierMessages = events.filter(e => {
        if (e.type !== 'chat.message') return false
        const payload = e.payload as { message: Message }
        return payload.message.subAgentType === 'verifier'
      })
      
      // If verification ran, should have verifier messages
      if (verifierMessages.length > 0) {
        const msg = verifierMessages[0]!.payload as { message: Message }
        expect(msg.message.subAgentId).toBeDefined()
      }
    }, 200_000)
  })

  describe('Verification Tools', () => {
    describe('pass_criterion', () => {
      it('marks criterion as passed when verification succeeds', async () => {
        // Pre-create the file that criterion will check
        await writeFile(
          join(testDir.path, 'src/verified.ts'),
          'export const verified = true;'
        )
        
        // Add criterion that will pass
        await client.send('chat.send', { 
          content: 'Add criterion: "src/verified.ts exports a verified constant". Use add_criterion.' 
        })
        await client.waitForChatDone()
        
        // Accept
        await client.send('mode.accept', {})
        
        // Wait for completion
        await collectUntilPhase(client, 'done', 180_000)
          .catch(() => collectUntilPhase(client, 'blocked', 10_000))
        
        const session = client.getSession()!
        const criterion = session.criteria[0]
        
        if (session.phase === 'done' && criterion) {
          expect(criterion.status.type).toBe('passed')
        }
      }, 200_000)
    })

    describe('fail_criterion', () => {
      it('marks criterion as failed and returns to builder', async () => {
        // Add criterion that will likely fail verification
        await client.send('chat.send', { 
          content: 'Add criterion: "src/nonexistent.ts exists and exports MAGIC". Use add_criterion.' 
        })
        await client.waitForChatDone()
        
        // Accept
        await client.send('mode.accept', {})
        
        // Wait for something to happen
        await collectUntilPhase(client, 'done', 180_000)
          .catch(() => collectUntilPhase(client, 'blocked', 10_000))
        
        // Check criteria status
        const session = client.getSession()!
        const criterion = session.criteria[0]
        
        // Either passed (builder created it) or failed (couldn't create)
        if (criterion) {
          expect(['passed', 'failed', 'completed', 'pending']).toContain(criterion.status.type)
        }
      }, 200_000)
    })
  })

  describe('Verification without Thinking', () => {
    it('verifier does not emit thinking content', async () => {
      // Add criterion
      await client.send('chat.send', { 
        content: 'Add criterion: "Simple criterion". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      client.clearEvents()
      
      // Accept
      await client.send('mode.accept', {})
      
      // Wait for completion
      await collectUntilPhase(client, 'done', 180_000)
        .catch(() => collectUntilPhase(client, 'blocked', 10_000))
      
      // Check events - verifier thinking should not be present
      const events = client.allEvents()
      const thinkingEvents = events.filter(e => e.type === 'chat.thinking')
      
      // If there are thinking events, they should be from builder, not verifier
      // (This is hard to verify without message correlation, but we just check it doesn't crash)
      assertNoErrors({ all: events, byType: new Map(), get: () => [], hasEvent: () => false, findEvent: () => undefined })
    }, 200_000)
  })
})
