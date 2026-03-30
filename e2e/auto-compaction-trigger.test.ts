import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createTestClient,
  createTestProject,
  createTestServer,
  createProject,
  createSession,
  type TestClient,
  type TestProject,
  type TestServerHandle,
} from './utils/index.js'

interface ContextState {
  currentTokens: number
  maxTokens: number
  compactionCount: number
}

describe('Auto-Compaction Trigger', () => {
  let server: TestServerHandle
  let client: TestClient
  let testDir: TestProject

  beforeAll(async () => {
    server = await createTestServer({ maxContext: 100 })
  })

  afterAll(async () => {
    await server.close()
  })

  beforeEach(async () => {
    client = await createTestClient({ url: server.wsUrl, timeout: 3000 })
    testDir = await createTestProject({ template: 'typescript' })

    const restProject = await createProject(server.url, { name: 'Auto-Compaction Trigger Test', workdir: testDir.path })
    const restSession = await createSession(server.url, { projectId: restProject.id })
    await client.send('session.load', { sessionId: restSession.id })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  it('automatically compacts before the next turn after threshold is exceeded', async () => {
    await client.send('chat.send', { content: 'First message that fills the tiny test context window.' })
    await client.waitForChatDone(3000)
    await client.waitFor('context.state', (payload: unknown) => {
      const context = (payload as { context: ContextState }).context
      return context.currentTokens > 0
    }, 3000)

    expect(client.getContextState()?.maxTokens).toBe(100)
    expect(client.getContextState()?.currentTokens).toBeGreaterThanOrEqual(100)

    client.clearEvents()

    await client.send('chat.send', { content: 'Second message should trigger auto compaction before processing.' })

    const compactionTurn = await client.waitForChatDone(3000)
    const finalTurn = await client.waitForChatDone(3000)

    expect(compactionTurn.reason).toBe('complete')
    expect(finalTurn.reason).toBe('complete')

    await client.waitFor('context.state', (payload: unknown) => {
      const context = (payload as { context: ContextState }).context
      return context.compactionCount >= 1
    }, 3000)

    const contextState = client.getContextState()!
    expect(contextState.compactionCount).toBeGreaterThanOrEqual(1)

    const summaryMessages = client.allEvents().filter((event) => {
      if (event.type !== 'chat.message') {
        return false
      }
      const message = event.payload as { message: { content: string } }
      return message.message.content.includes('Previous context summary:')
    })
    expect(summaryMessages.length).toBeGreaterThan(0)

    const chatDoneEvents = client.allEvents().filter((event) => event.type === 'chat.done')
    expect(chatDoneEvents.length).toBeGreaterThanOrEqual(2)
  }, 10000)
})
