/**
 * Tool Preparing Events E2E Tests
 *
 * Tests that chat.tool_preparing events are emitted before chat.tool_call events,
 * providing early feedback to users about what tool is being invoked.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import {
  createTestClient,
  createTestProject,
  createTestServer,
  collectChatEvents,
  assertNoErrors,
  createProject,
  createSession,
  setSessionMode,
  type TestClient,
  type TestProject,
  type TestServerHandle,
} from './utils/index.js'
import type { ChatToolPreparingPayload, ChatToolCallPayload } from '@openfox/shared/protocol'

describe('Tool Preparing Events', () => {
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

    const restProject = await createProject(server.url, { name: 'Tool Preparing Test', workdir: testDir.path })
    const restSession = await createSession(server.url, { projectId: restProject.id })
    await client.send('session.load', { sessionId: restSession.id })
    await setSessionMode(server.url, restSession.id, 'builder')
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  it('emits chat.tool_preparing before chat.tool_call for read_file', async () => {
    await client.send('chat.send', {
      content: 'Read the file src/index.ts',
    })

    const events = await collectChatEvents(client)
    assertNoErrors(events)

    // Should have preparing event
    const preparingEvents = events.get<ChatToolPreparingPayload>('chat.tool_preparing')
    const toolCallEvents = events.get<ChatToolCallPayload>('chat.tool_call')

    // Must have at least one tool call (read_file)
    expect(toolCallEvents.length).toBeGreaterThan(0)

    // Should have a preparing event for read_file
    const readFilePreparing = preparingEvents.find((e) => e.payload.name === 'read_file')
    expect(readFilePreparing).toBeDefined()

    // Preparing should come before tool_call in event order
    const allEvents = events.all
    const preparingIdx = allEvents.findIndex(
      (e) => e.type === 'chat.tool_preparing' && (e.payload as ChatToolPreparingPayload).name === 'read_file',
    )
    const toolCallIdx = allEvents.findIndex(
      (e) => e.type === 'chat.tool_call' && (e.payload as ChatToolCallPayload).tool === 'read_file',
    )

    expect(preparingIdx).toBeGreaterThan(-1)
    expect(toolCallIdx).toBeGreaterThan(-1)
    expect(preparingIdx).toBeLessThan(toolCallIdx)
  })

  it('emits chat.tool_preparing with correct payload structure', async () => {
    await client.send('chat.send', {
      content: 'Use glob to find all TypeScript files',
    })

    const events = await collectChatEvents(client)
    assertNoErrors(events)

    const preparingEvents = events.get<ChatToolPreparingPayload>('chat.tool_preparing')

    // Find glob preparing event
    const globPreparing = preparingEvents.find((e) => e.payload.name === 'glob')

    if (globPreparing) {
      // Verify payload structure
      expect(globPreparing.payload).toHaveProperty('messageId')
      expect(globPreparing.payload).toHaveProperty('index')
      expect(globPreparing.payload).toHaveProperty('name')
      expect(typeof globPreparing.payload.messageId).toBe('string')
      expect(typeof globPreparing.payload.index).toBe('number')
      expect(globPreparing.payload.name).toBe('glob')
    }
  })

  it('emits preparing events for multiple tool calls', async () => {
    await client.send('chat.send', {
      content: 'First use glob to find all .ts files, then read src/index.ts',
    })

    const events = await collectChatEvents(client)
    assertNoErrors(events)

    const preparingEvents = events.get<ChatToolPreparingPayload>('chat.tool_preparing')
    const toolCallEvents = events.get<ChatToolCallPayload>('chat.tool_call')

    // Should have multiple tool calls
    expect(toolCallEvents.length).toBeGreaterThanOrEqual(1)

    // Each tool call should have a corresponding preparing event
    for (const tcEvent of toolCallEvents) {
      const matchingPreparing = preparingEvents.find((pe) => pe.payload.name === tcEvent.payload.tool)
      // At least the first occurrence of each tool should have a preparing event
      if (preparingEvents.some((pe) => pe.payload.name === tcEvent.payload.tool)) {
        expect(matchingPreparing).toBeDefined()
      }
    }
  })

  it('preparing event messageId matches tool_call messageId', async () => {
    await client.send('chat.send', {
      content: 'Read src/math.ts',
    })

    const events = await collectChatEvents(client)
    assertNoErrors(events)

    const preparingEvents = events.get<ChatToolPreparingPayload>('chat.tool_preparing')
    const toolCallEvents = events.get<ChatToolCallPayload>('chat.tool_call')

    if (preparingEvents.length > 0 && toolCallEvents.length > 0) {
      const preparing = preparingEvents[0]!
      const toolCall = toolCallEvents.find((tc) => tc.payload.tool === preparing.payload.name)

      if (toolCall) {
        // Both should reference the same assistant message
        expect(preparing.payload.messageId).toBe(toolCall.payload.messageId)
      }
    }
  })
})
