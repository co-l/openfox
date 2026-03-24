/**
 * Sub-Agent Message Ordering Tests
 * 
 * Tests that verify sub-agent messages arrive in the correct order
 * and persist through session.state refreshes.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { 
  createTestClient, 
  createTestProject,
  createTestServer,
  collectUntilPhase,
  assertNoErrors,
  type TestClient, 
  type TestProject,
  type TestServerHandle 
} from './utils/index.js'
import type { Message } from '@openfox/shared'

describe('Sub-Agent Message Ordering', () => {
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
    
    await client.send('project.create', { name: 'Sub-Agent Ordering Test', workdir: testDir.path })
    const projectId = client.getProject()!.id
    await client.send('session.create', { projectId })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  // SKIP: Requires actual verifier sub-agent implementation (not mocked)
  it.skip('verifier sub-agent messages arrive in correct order: context-reset -> auto-prompt -> assistant', async () => {
    await client.send('chat.send', {
      content: 'Add criterion ID "order-test": "Test criterion for ordering". Use add_criterion.',
    })
    await client.waitForChatDone()
    await client.send('mode.switch', { mode: 'builder' })
    await client.send('runner.launch', {})

    // Collect all verifier messages
    const events = await collectUntilPhase(client, 'verification', 3_000)
    const verifierMessages = events.get('chat.message')?.filter(e => {
      const payload = e.payload as { message: Message }
      return payload.message.subAgentType === 'verifier'
    }) ?? []

    // Verify ordering: context-reset should come before auto-prompt, which should come before assistant
    const contextResetIndex = verifierMessages.findIndex(e => {
      const payload = e.payload as { message: Message }
      return payload.message.messageKind === 'context-reset'
    })
    
    const autoPromptIndex = verifierMessages.findIndex(e => {
      const payload = e.payload as { message: Message }
      return payload.message.messageKind === 'auto-prompt'
    })
    
    const assistantIndex = verifierMessages.findIndex(e => {
      const payload = e.payload as { message: Message }
      return payload.message.role === 'assistant'
    })

    expect(contextResetIndex).toBeGreaterThanOrEqual(0)
    expect(autoPromptIndex).toBeGreaterThanOrEqual(0)
    expect(assistantIndex).toBeGreaterThanOrEqual(0)
    expect(contextResetIndex).toBeLessThan(autoPromptIndex)
    expect(autoPromptIndex).toBeLessThan(assistantIndex)
  })

  // SKIP: Requires actual verifier sub-agent implementation (not mocked)
  it.skip('sub-agent assistant content persists after session.state refresh', async () => {
    await client.send('chat.send', {
      content: 'Add criterion ID "persist-test": "Test persistence". Use add_criterion.',
    })
    await client.waitForChatDone()
    await client.send('mode.switch', { mode: 'builder' })
    await client.send('runner.launch', {})

    // Wait for verification to complete
    await collectUntilPhase(client, 'done', 5_000)

    // Get the session state (this simulates a page reload or refresh)
    const sessionAfterVerification = client.getSession()!
    
    // Find verifier messages in the session
    const verifierMessages = sessionAfterVerification.messages.filter(m => 
      m.subAgentType === 'verifier'
    )

    // Should have context-reset, auto-prompt, and at least one assistant message
    const hasContextReset = verifierMessages.some(m => m.messageKind === 'context-reset')
    const hasAutoPrompt = verifierMessages.some(m => m.messageKind === 'auto-prompt')
    const hasAssistant = verifierMessages.some(m => m.role === 'assistant')

    expect(hasContextReset).toBe(true)
    expect(hasAutoPrompt).toBe(true)
    expect(hasAssistant).toBe(true)

    // Assistant message should have content (not be empty)
    const assistantMessage = verifierMessages.find(m => m.role === 'assistant')
    expect(assistantMessage?.content).toBeTruthy()
    expect(assistantMessage?.content.length).toBeGreaterThan(0)
  })
})
