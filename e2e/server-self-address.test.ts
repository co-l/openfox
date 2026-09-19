/**
 * Self-addressing environment.
 *
 * Agent shells reach their own server over HTTP (the end-of-session routine
 * appends lines to global instructions that way). A shell inherits this
 * process's environment, so the port actually listened on has to be in it -
 * otherwise a dev server would have its agents talking to production.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestServer, type TestServerHandle } from './utils/index.js'

describe('server self-address', () => {
  let server: TestServerHandle

  beforeAll(async () => {
    server = await createTestServer()
  })

  afterAll(async () => {
    await server.close()
  })

  it('publishes the listening port and base URL to child processes', async () => {
    // The server is really there before checking what it told the environment.
    expect((await fetch(`${server.url}/api/health`)).status).toBe(200)

    expect(process.env['OPENFOX_PORT']).toBe(String(server.port))
    expect(process.env['OPENFOX_API']).toBe(`http://127.0.0.1:${server.port}`)
  })
})
