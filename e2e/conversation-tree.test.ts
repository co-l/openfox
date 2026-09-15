/**
 * Conversation Tree E2E Tests (v3.0.0-beta)
 *
 * Exercises the message-level tree storage through the public WS/REST
 * interfaces against an in-process server with the mock LLM:
 *
 * - GET /api/sessions/:id/conversation-tree (nodes / cursor / tips shape)
 * - Fork: O(1) shared tree, new session row points at (tree, node)
 * - Edit & resend: sibling node + cursor move, original branch preserved
 * - Branch switch: cursor rewind to an abandoned tip (WS + REST parity)
 * - Issue #334: forking a compacted session must NOT re-inject the
 *   discarded pre-compaction history into the fork's LLM context
 * - Export/import: v2 tree document round-trips; v1 payloads are rejected
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
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
import type { Message } from '@openfox/shared'

// ============================================================================
// REST helpers
// ============================================================================

interface SessionRestPayload {
  session: { id: string; isRunning: boolean; title?: string }
  messages: Message[]
  hiddenCount?: number
}

interface ConversationTreePayload {
  treeId: string
  cursor: string | null
  tips: Array<{ eventId: string; timestamp: number; type: string; preview?: string; role?: string }>
  nodes: Array<{
    eventId: string
    parentId: string | null
    seq: number
    timestamp: number
    type: string
    messageId?: string
    role?: string
    preview?: string
  }>
}

async function getSession(baseUrl: string, sessionId: string): Promise<SessionRestPayload> {
  const res = await fetch(`${baseUrl}/api/sessions/${sessionId}`)
  if (!res.ok) throw new Error(`GET session failed: ${res.status}`)
  return (await res.json()) as SessionRestPayload
}

async function getTree(baseUrl: string, sessionId: string): Promise<ConversationTreePayload> {
  const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/conversation-tree`)
  if (!res.ok) throw new Error(`GET conversation-tree failed: ${res.status}`)
  return (await res.json()) as ConversationTreePayload
}

async function forkSession(
  baseUrl: string,
  sessionId: string,
  messageId: string,
  title?: string,
): Promise<{ status: number; body: { session?: { id: string }; error?: string } }> {
  const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId, ...(title !== undefined ? { title } : {}) }),
  })
  const body = (await res.json().catch(() => ({}))) as { session?: { id: string }; error?: string }
  return { status: res.status, body }
}

async function replayMessage(
  baseUrl: string,
  sessionId: string,
  messageId: string,
  content?: string,
): Promise<{ status: number; body: { success?: boolean; messageId?: string; error?: string } }> {
  const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId, ...(content !== undefined ? { content } : {}) }),
  })
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; messageId?: string; error?: string }
  return { status: res.status, body }
}

async function switchBranch(
  baseUrl: string,
  sessionId: string,
  messageId: string,
): Promise<{ status: number; body: { success?: boolean; error?: string } }> {
  const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/conversation-branch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId }),
  })
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string }
  return { status: res.status, body }
}

function userMessages(messages: Message[]): Message[] {
  // Real user messages only — system-injected reminders also carry role 'user'
  return messages.filter((m) => m.role === 'user' && !m.isSystemGenerated)
}

/** Walk parentId links from the cursor back to the root: the current path. */
function pathFromCursor(tree: ConversationTreePayload): string[] {
  const parentOf = new Map(tree.nodes.map((n) => [n.eventId, n.parentId]))
  const path: string[] = []
  let current: string | null = tree.cursor
  while (current !== null) {
    path.push(current)
    current = parentOf.get(current) ?? null
  }
  return path
}

// ============================================================================
// Tests
// ============================================================================

describe('Conversation Tree (v3)', () => {
  let server: TestServerHandle
  let client: TestClient
  let testDir: TestProject
  let projectId: string
  let sessionId: string

  beforeAll(async () => {
    server = await createTestServer()
  })

  afterAll(async () => {
    await server.close()
  })

  beforeEach(async () => {
    client = await createTestClient({ url: server.wsUrl })
    testDir = await createTestProject({ template: 'typescript' })
    const project = await createProject(server.url, { name: 'Conversation Tree Test', workdir: testDir.path })
    projectId = project.id
    const session = await createSession(server.url, { projectId })
    sessionId = session.id
    await client.send('session.load', { sessionId })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  async function chat(content: string): Promise<void> {
    await client.send('chat.send', { content })
    await client.waitForChatDone()
  }

  describe('conversation-tree endpoint', () => {
    it('exposes tree nodes, cursor, and no tips for a linear session', async () => {
      await chat('First message for the tree test.')
      await chat('Second message for the tree test.')

      const tree = await getTree(server.url, sessionId)

      expect(tree.treeId).toBeTruthy()
      expect(tree.nodes.length).toBeGreaterThan(2)
      for (const node of tree.nodes) {
        expect(node.eventId).toBeTruthy()
        expect(typeof node.seq).toBe('number')
        expect(typeof node.timestamp).toBe('number')
        expect(typeof node.type).toBe('string')
      }

      // Exactly one root node (parentId === null)
      const roots = tree.nodes.filter((n) => n.parentId === null)
      expect(roots.length).toBe(1)

      // Cursor is a real node and is the end of the path
      expect(tree.cursor).not.toBeNull()
      const cursorNode = tree.nodes.find((n) => n.eventId === tree.cursor)
      expect(cursorNode).toBeTruthy()

      // Linear session: no abandoned branch tips
      expect(tree.tips).toEqual([])

      // Both user messages are tree nodes
      const messageNodes = tree.nodes.filter((n) => n.type === 'message')
      const contents = (await getSession(server.url, sessionId)).messages
      for (const msg of contents) {
        expect(messageNodes.some((n) => n.messageId === msg.id)).toBe(true)
      }
    })
  })

  describe('Fork (shared tree, O(1))', () => {
    it('creates a session sharing the tree whose path ends at the fork point', async () => {
      await chat('Alpha message.')
      await chat('Beta message.')

      const original = await getSession(server.url, sessionId)
      const users = userMessages(original.messages)
      expect(users.length).toBeGreaterThanOrEqual(2)
      const forkPoint = users[1]!

      const { status, body } = await forkSession(server.url, sessionId, forkPoint.id, 'Forked session')
      expect(status).toBe(201)
      expect(body.session?.id).toBeTruthy()
      const forkedId = body.session!.id

      // Shared tree: same treeId for both sessions
      const originalTree = await getTree(server.url, sessionId)
      const forkedTree = await getTree(server.url, forkedId)
      expect(forkedTree.treeId).toBe(originalTree.treeId)

      // Fork path = shared prefix up to the fork point
      const forked = await getSession(server.url, forkedId)
      expect(forked.messages.length).toBeLessThan(original.messages.length)
      const forkedUsers = userMessages(forked.messages)
      expect(forkedUsers.map((m) => m.id)).toEqual(users.map((m) => m.id).slice(0, 2))

      // Fork cursor sits on the fork point node
      expect(forkedTree.cursor).toBe(forkedTree.nodes.find((n) => n.messageId === forkPoint.id)?.eventId)

      // Original session is untouched
      const afterFork = await getSession(server.url, sessionId)
      expect(afterFork.messages.map((m) => m.id)).toEqual(original.messages.map((m) => m.id))
      const afterForkTree = await getTree(server.url, sessionId)
      expect(afterForkTree.cursor).toBe(originalTree.cursor)

      // The forked session can continue chatting on the shared tree
      const client2 = await createTestClient({ url: server.wsUrl })
      try {
        await client2.send('session.load', { sessionId: forkedId })
        await client2.send('chat.send', { content: 'Gamma message on the fork.' })
        await client2.waitForChatDone()

        const forkedAfter = await getSession(server.url, forkedId)
        expect(userMessages(forkedAfter.messages).at(-1)?.content).toBe('Gamma message on the fork.')

        // Original session still has no trace of the fork's new turn
        const afterOriginal = await getSession(server.url, sessionId)
        expect(afterOriginal.messages.map((m) => m.id)).toEqual(original.messages.map((m) => m.id))
      } finally {
        await client2.close()
      }
    })

    it('rejects a fork from an unknown message', async () => {
      await chat('Only message.')
      const { status, body } = await forkSession(server.url, sessionId, 'no-such-message', 'Bad fork')
      expect(status).toBe(404)
      expect(body.error).toContain('not found')
    })
  })

  describe('Edit & resend (sibling node) + branch switch', () => {
    it('resends a middle message as a sibling, keeps the old branch, and switches back', async () => {
      await chat('Original first question.')
      await chat('Second question.')

      const before = await getSession(server.url, sessionId)
      const users = userMessages(before.messages)
      const first = users[0]!
      const second = users[1]!
      const originalIds = before.messages.map((m) => m.id)

      // Resend the first message with edited content
      const replay = await replayMessage(server.url, sessionId, first.id, 'Edited first question.')
      expect(replay.status).toBe(200)
      expect(replay.body.success).toBe(true)
      expect(replay.body.messageId).not.toBe(first.id)
      const siblingId = replay.body.messageId!

      // The resend queues a turn — let it finish
      await client.waitForChatDone(15000)

      const afterResend = await getSession(server.url, sessionId)
      const afterUsers = userMessages(afterResend.messages)

      // Current path starts with the edited sibling, not the original
      expect(afterUsers[0]?.id).toBe(siblingId)
      expect(afterUsers[0]?.content).toBe('Edited first question.')
      // The old second message is off-path (abandoned branch), not in the view
      expect(afterUsers.some((m) => m.id === second.id)).toBe(false)
      // Nothing was duplicated
      const ids = afterResend.messages.map((m) => m.id)
      expect(new Set(ids).size).toBe(ids.length)

      // Tree: the original branch tail is now an abandoned tip
      const tree = await getTree(server.url, sessionId)
      expect(tree.tips.length).toBeGreaterThan(0)
      const abandonedIds = new Set(tree.tips.map((t) => t.eventId))
      const originalLast = before.messages[before.messages.length - 1]!
      expect(tree.nodes.some((n) => n.messageId === originalLast.id)).toBe(true)
      expect(abandonedIds.size).toBeGreaterThan(0)

      // Switch back to the original branch (cursor moves to its last message)
      const branch = await switchBranch(server.url, sessionId, originalLast.id)
      expect(branch.status).toBe(200)
      expect(branch.body.success).toBe(true)

      const restored = await getSession(server.url, sessionId)
      expect(restored.messages.map((m) => m.id)).toEqual(originalIds)
      expect(userMessages(restored.messages)[0]?.content).toBe('Original first question.')

      // The edited branch (sibling + its new reply) is now the abandoned tip
      const editedBranchTip = afterResend.messages[afterResend.messages.length - 1]!
      const editedBranchTipNode = tree.nodes.find((n) => n.messageId === editedBranchTip.id)
      expect(editedBranchTipNode).toBeTruthy()
      const treeAfterSwitch = await getTree(server.url, sessionId)
      expect(treeAfterSwitch.tips.some((t) => t.eventId === editedBranchTipNode!.eventId)).toBe(true)
    })

    it('refuses to switch branches while the session is running', async () => {
      await chat('Setup message.')
      const session = (await getSession(server.url, sessionId)).session
      expect(session.isRunning).toBe(false)

      // Start a turn, then immediately try to switch
      void client.send('chat.send', { content: 'A long-ish turn.' })
      try {
        await client.waitFor('session.running', (p: { isRunning: boolean }) => p.isRunning, 5000)
        const first = userMessages((await getSession(server.url, sessionId)).messages)[0]!
        const result = await switchBranch(server.url, sessionId, first.id)
        expect(result.status).toBe(409)
      } catch {
        // Session finished before we could probe — acceptable with the mock LLM
      }

      await client.waitForChatDone()
      const stopped = (await getSession(server.url, sessionId)).session
      expect(stopped.isRunning).toBe(false)
    })
  })

  describe('Issue #334 — fork after compaction', () => {
    it('does not re-inject discarded history into the fork', async () => {
      // Seed history with a marker, then pad
      await chat('My secret magic word is ABRACADABRA. Remember it forever.')
      await chat('Padding message two.')
      await chat('Padding message three.')

      // Compact: the pre-compaction history (incl. the marker) is discarded
      const compact = await client.send('context.compact', {})
      expect(compact.type).toBe('ack')
      await client.waitForChatDone(15000)

      // Baseline: the compacted session itself has forgotten the marker
      client.clearEvents()
      await client.send('chat.send', { content: 'what is the magic word?' })
      const probeDone = await client.waitForChatDone()
      expect(probeDone.content).not.toContain('ABRACADABRA')

      // Fork from a post-compaction message
      const current = await getSession(server.url, sessionId)
      const users = userMessages(current.messages)
      const lastUser = users[users.length - 1]!
      const { status, body } = await forkSession(server.url, sessionId, lastUser.id, 'Post-compaction fork')
      expect(status).toBe(201)
      const forkedId = body.session!.id

      // Fork shares the tree (and its compaction boundary)
      const originalTree = await getTree(server.url, sessionId)
      const forkedTree = await getTree(server.url, forkedId)
      expect(forkedTree.treeId).toBe(originalTree.treeId)

      // Probe in the fork: the discarded marker must NOT reappear
      const client2 = await createTestClient({ url: server.wsUrl })
      try {
        await client2.send('session.load', { sessionId: forkedId })
        await client2.send('chat.send', { content: 'what is the magic word?' })
        const forkProbe = await client2.waitForChatDone()
        expect(forkProbe.content).not.toContain('ABRACADABRA')
      } finally {
        await client2.close()
      }
    }, 30000)
  })

  describe('Export / import (v2 tree document)', () => {
    it('round-trips a branched session into a new project', async () => {
      await chat('Export test question one.')
      await chat('Export test question two.')

      // Create a branch via resend so the export contains abandoned tips
      const users = userMessages((await getSession(server.url, sessionId)).messages)
      const first = users[0]!
      const replay = await replayMessage(server.url, sessionId, first.id, 'Export test question one (edited).')
      expect(replay.status).toBe(200)
      await client.waitForChatDone(15000)

      const source = await getSession(server.url, sessionId)

      // Export
      const exportRes = await fetch(`${server.url}/api/sessions/${sessionId}/export`)
      expect(exportRes.status).toBe(200)
      const exportPayload = (await exportRes.json()) as {
        format: string
        version: number
        cursorEventId: string | null
        session: { title?: string }
        events: Array<{ eventId: string; parentId?: string | null; type: string }>
      }
      expect(exportPayload.format).toBe('openfox-session')
      expect(exportPayload.version).toBe(2)
      expect(exportPayload.cursorEventId).not.toBeNull()
      expect(exportPayload.events.length).toBeGreaterThan(0)
      for (const event of exportPayload.events) {
        expect(event.eventId).toBeTruthy()
      }

      // Import into a fresh project
      const importProject = await createProject(server.url, { name: 'Import Target', workdir: testDir.path })
      const importRes = await fetch(`${server.url}/api/sessions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: importProject.id, payload: exportPayload }),
      })
      expect(importRes.status).toBe(201)
      const importBody = (await importRes.json()) as { session: { id: string } }
      const importedId = importBody.session.id

      // Imported session: same visible conversation as the source's current
      // path, plus the import drift-reminder/marker messages appended by design
      const imported = await getSession(server.url, importedId)
      const importedHead = imported.messages.slice(0, source.messages.length)
      expect(importedHead.map((m) => m.content)).toEqual(source.messages.map((m) => m.content))
      expect(importedHead.map((m) => m.role)).toEqual(source.messages.map((m) => m.role))
      const tail = imported.messages.slice(source.messages.length)
      expect(tail.some((m) => m.content.includes('imported'))).toBe(true)

      // Imported tree: the source's current path is fully preserved (the
      // export carries the path, not abandoned branches), and the imported
      // cursor is a valid node (advanced past the appended import marker).
      const sourceTree = await getTree(server.url, sessionId)
      const importedTree = await getTree(server.url, importedId)
      const sourcePath = pathFromCursor(sourceTree)
      const importedNodeIds = new Set(importedTree.nodes.map((n) => n.eventId))
      for (const eventId of sourcePath) {
        expect(importedNodeIds.has(eventId)).toBe(true)
      }
      expect(importedTree.cursor).not.toBeNull()
      expect(importedNodeIds.has(importedTree.cursor!)).toBe(true)
    })

    it('rejects pre-v3 (version 1) exports with a clear error', async () => {
      const v1Payload = {
        format: 'openfox-session',
        version: 1,
        session: { title: 'legacy' },
        events: [],
      }
      const res = await fetch(`${server.url}/api/sessions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, payload: v1Payload }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('not supported')
    })
  })

  describe('WS / REST parity', () => {
    it('session.state broadcast after a branch switch matches the REST payload', async () => {
      await chat('Parity question one.')
      await chat('Parity question two.')

      const users = userMessages((await getSession(server.url, sessionId)).messages)
      const first = users[0]!
      const replay = await replayMessage(server.url, sessionId, first.id, 'Parity question one (edited).')
      expect(replay.status).toBe(200)
      await client.waitForChatDone(15000)

      const original = await getSession(server.url, sessionId)
      const originalLast = original.messages[original.messages.length - 1]!
      client.clearEvents()

      const branch = await switchBranch(server.url, sessionId, originalLast.id)
      expect(branch.status).toBe(200)

      const stateMsg = await client.waitFor('session.state')
      const wsMessages = (stateMsg.payload as { messages: Message[] }).messages

      const rest = await getSession(server.url, sessionId)
      expect(wsMessages.map((m) => m.id)).toEqual(rest.messages.map((m) => m.id))
      expect(wsMessages.map((m) => m.content)).toEqual(rest.messages.map((m) => m.content))
    })
  })
})
