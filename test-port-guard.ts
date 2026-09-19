/**
 * Test setup: never bind to a port fetch itself refuses to reach.
 *
 * WHATWG fetch blocks a long list of ports (https://fetch.spec.whatwg.org/#scheme-fetch-port-blocklist),
 * and undici implements it - a request to such a port fails with
 * "TypeError: fetch failed" caused by "bad port", without ever hitting the
 * network. The OS assigns listen(0) ports from the ephemeral range, which
 * often starts at 1024, so a random test-server port can land on the
 * blocklist (it reaches 10080) and then every request to that server fails
 * - flakily, depending on where the ephemeral cursor happens to sit.
 *
 * Retries are invisible to the listen *callback*; an on('listening') listener
 * would fire on the first, possibly blocked, bind before the guard closes it.
 * Servers bound via listen(0) must therefore read their address from the
 * listen callback (or later), not from a 'listening' event listener.
 *
 * Loaded via setupFiles in both vitest configs, this patches net.Server
 * (and thus http.Server) so listen(0) retries until the assigned port is
 * off the blocklist. Port-specific binds are left untouched.
 */

import net from 'node:net'

export const BLOCKED_FETCH_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110,
  111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061,
  6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
])

export function isBlockedFetchPort(port: number): boolean {
  return BLOCKED_FETCH_PORTS.has(port)
}

const LISTEN_ZERO_RETRY_LIMIT = 50

type ListenFn = (this: net.Server, ...args: never[]) => net.Server
const originalListen = net.Server.prototype.listen as ListenFn

function isBlockedPort(server: net.Server): boolean {
  const addr = server.address()
  return addr !== null && typeof addr === 'object' && BLOCKED_FETCH_PORTS.has(addr.port)
}

// Overloads with a numeric first argument (port); path/pipe/options binds
// have no ephemeral port choice and pass through untouched.
function listenZeroSafe(this: net.Server, ...args: unknown[]): net.Server {
  if (args[0] !== 0) {
    return (originalListen as (...a: unknown[]) => net.Server).apply(this, args)
  }

  const lastIndex = args.length - 1
  const userCallback = typeof args[lastIndex] === 'function' ? (args[lastIndex] as () => void) : undefined
  const prefixArgs = userCallback ? args.slice(0, lastIndex) : args

  const listenAgain = (attemptsLeft: number): void => {
    const onListening = (): void => {
      if (attemptsLeft > 0 && isBlockedPort(this)) {
        this.close(() => listenAgain(attemptsLeft - 1))
        return
      }
      userCallback?.()
    }
    ;(originalListen as (...a: unknown[]) => net.Server).apply(this, [...prefixArgs, onListening])
  }

  listenAgain(LISTEN_ZERO_RETRY_LIMIT)
  return this
}

net.Server.prototype.listen = listenZeroSafe as never
