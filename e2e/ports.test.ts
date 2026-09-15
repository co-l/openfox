/**
 * Dynamic test ports must stay off the WHATWG fetch port blocklist.
 *
 * The OS hands out ports from the ephemeral range, which often starts at
 * 1024, so a listen(0) port can land on one of the ports fetch refuses to
 * talk to - and then every request to that test server dies with
 * "TypeError: fetch failed / bad port" (undici), flakily depending on where
 * the ephemeral cursor sits.
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { createTestServer, getFreePort, isBlockedFetchPort, type TestServerHandle } from './utils/index.js'

const require = createRequire(import.meta.url)
// undici's own list holds string ports (URL.prototype.port is a string)
const { badPortsSet } = require('undici/lib/web/fetch/constants.js') as { badPortsSet: Set<string> }

describe('test port allocation', () => {
  it('blocklist matches the one fetch itself enforces', () => {
    for (const port of badPortsSet) {
      expect(isBlockedFetchPort(Number(port))).toBe(true)
    }
    expect(isBlockedFetchPort(10369)).toBe(false)
    expect(isBlockedFetchPort(0)).toBe(false)
  })

  it('getFreePort never returns a blocked port', async () => {
    for (let i = 0; i < 40; i++) {
      const port = await getFreePort()
      expect(isBlockedFetchPort(port)).toBe(false)
      expect(port).toBeGreaterThan(0)
    }
  })

  it('createTestServer listens on a port fetch can reach', async () => {
    const servers: TestServerHandle[] = []
    try {
      for (let i = 0; i < 3; i++) {
        const server = await createTestServer()
        servers.push(server)
        expect(isBlockedFetchPort(server.port)).toBe(false)
        const res = await fetch(`${server.url}/api/health`)
        expect(res.status).toBe(200)
      }
    } finally {
      for (const server of servers) await server.close()
    }
  })
})
