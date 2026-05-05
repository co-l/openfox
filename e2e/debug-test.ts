import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  createSessionPool,
  createTestServer,
  collectChatEvents,
  assertNoErrors,
  type TestServerHandle,
  type SessionPool,
} from './utils/index.js'

let server: TestServerHandle
let pool: SessionPool

describe('Debug', () => {
  beforeAll(async () => {
    server = await createTestServer()
    pool = createSessionPool({ template: 'typescript', mode: 'planner', wsUrl: server.wsUrl })
    await pool.setup()
  })
  afterAll(async () => {
    await pool.cleanup()
    await server.close()
  })
  beforeEach(async () => {
    await pool.reset()
  })

  it('debug criteria', async () => {
    const { client } = pool.get()

    await client.send('chat.send', {
      content:
        'I want to add a multiply function to math.ts. Propose acceptance criteria for this task. Use the add_criterion tool.',
    })

    const events = await collectChatEvents(client)
    console.log('All events:', JSON.stringify(Array.from(events.entries()), null, 2))

    const session = client.getSession()!
    console.log('Session criteria:', session.criteria)
  })
})
