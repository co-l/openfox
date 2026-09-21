/**
 * Cross-window session list freshness
 *
 * A window sitting on the homepage has no active session, so it is not
 * subscribed to any project's session stream. Creating a session in another
 * window must still notify it (via session.created) so the homepage's recent
 * sessions list does not go stale.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestServer,
  createTestClient,
  createProject,
  createSession,
  type TestServerHandle,
} from './utils/index.js'

describe('session.created broadcast', () => {
  let server: TestServerHandle

  beforeAll(async () => {
    server = await createTestServer()
  })

  afterAll(async () => {
    await server.close()
  })

  it('reaches a homepage client (no active session) when a session is created in another window', async () => {
    const project = await createProject(server.url, { name: 'broadcast-test', workdir: '/tmp/broadcast-test' })

    // This client simulates a window sitting on the homepage: connected to the
    // WebSocket but with no session loaded (no project subscription).
    const homepageClient = await createTestClient({ url: server.wsUrl })

    try {
      homepageClient.clearEvents()

      const session = await createSession(server.url, { projectId: project.id, title: 'Cross-window session' })

      const createdMsg = await homepageClient.waitFor(
        'session.created',
        (payload) => (payload as { session: { id: string } }).session.id === session.id,
        5_000,
      )
      expect(createdMsg).toBeTruthy()
      expect((createdMsg.payload as { session: { title?: string } }).session.title).toBe('Cross-window session')
    } finally {
      await homepageClient.close()
    }
  })
})
