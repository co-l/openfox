import { readFile } from 'node:fs/promises'
import { createHash, createSign, privateDecrypt } from 'node:crypto'
import { password, isCancel, cancel } from '@clack/prompts'
import type { Mode } from './main.js'
import { loadAuthConfig } from './auth.js'
import { loadGlobalConfig } from './config.js'
import { getAuthKeyPath } from './paths.js'
import { buildOpenFoxMcpBootstrap, type OpenFoxMcpBootstrapConfig } from '../server/mcp/server/bootstrap.js'
import { cliT } from './i18n.js'

const MODE_DEFAULT_PORTS: Record<Mode, number> = { production: 10369, development: 10469, test: 10369 }
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '*'])
const PROBE_INCREMENT = 15

function probeHost(host: string): string {
  return WILDCARD_HOSTS.has(host) ? '127.0.0.1' : host
}

/**
 * Candidate ports to probe for a live server: the preferred port (mode
 * default — the binary's identity), the configured/requested port, and a few
 * increments of each (dev servers auto-increment when the default port is
 * taken).
 */
export function portCandidates(preferred: number, fallback: number): number[] {
  const candidates = [preferred, fallback]
  for (let i = 1; i <= PROBE_INCREMENT; i++) {
    candidates.push(preferred + i)
    candidates.push(fallback + i)
  }
  return [...new Set(candidates)]
}

/**
 * Return the first port where the OpenFox /api/health endpoint responds, or
 * null when no server is found on any candidate.
 */
export async function findLivePort(host: string, candidates: number[]): Promise<number | null> {
  for (const port of candidates) {
    try {
      const res = await fetch(`http://${host}:${port}/api/health`, { signal: AbortSignal.timeout(400) })
      if (res.ok) return port
    } catch {
      // Port is not serving OpenFox — keep probing
    }
  }
  return null
}

/**
 * Verify a plaintext password against the RSA-encrypted password stored in the
 * auth config. Pure — no process-global state, unlike the server's variant.
 */
export function verifyPassword(encryptedPassword: string, privateKey: string, entered: string): boolean {
  try {
    const decrypted = privateDecrypt({ key: privateKey, padding: 4 }, Buffer.from(encryptedPassword, 'base64'))
    return decrypted.toString() === entered
  } catch {
    try {
      const decrypted = privateDecrypt({ key: privateKey, padding: 1 }, Buffer.from(encryptedPassword, 'base64'))
      return decrypted.toString() === entered
    } catch {
      return false
    }
  }
}

/**
 * Mint a session token for the given password: an RSA signature over the
 * password hash, identical to the server's tokenFromPassword.
 */
export function signSessionToken(privateKey: string, passwordValue: string): string {
  const passwordHash = createHash('sha256').update(passwordValue).digest('hex')
  const sign = createSign('SHA256')
  sign.update(passwordHash)
  sign.end()
  return sign.sign(privateKey, 'base64')
}

/**
 * Render the bootstrap config as a paste-ready MCP client configuration
 * (mcpServers block, as used by Claude Desktop, Cursor, and friends).
 */
export function renderMcpClientConfig(bootstrap: OpenFoxMcpBootstrapConfig): string {
  const server: Record<string, unknown> = { url: bootstrap.url }
  if (bootstrap.headers) {
    server['headers'] = bootstrap.headers
  }
  return JSON.stringify({ mcpServers: { [bootstrap.name]: server } }, null, 2)
}

export async function runMcpCommand(mode: Mode, options: { password?: string; port?: number } = {}): Promise<void> {
  const config = await loadGlobalConfig(mode)
  const auth = await loadAuthConfig(mode)

  const host = config.server?.host ?? '127.0.0.1'
  const configuredPort = config.server?.port ?? MODE_DEFAULT_PORTS[mode]
  const requestedPort = options.port ?? configuredPort

  const livePort = await findLivePort(probeHost(host), portCandidates(MODE_DEFAULT_PORTS[mode], requestedPort))
  const port = livePort ?? requestedPort
  if (!livePort) {
    console.warn(
      cliT({
        en: `\n⚠ No running OpenFox server detected near port ${requestedPort} — the config below assumes it will start there.`,
        fr: `\n⚠ Aucun serveur OpenFox en cours détecté près du port ${requestedPort} — la configuration ci-dessous suppose qu’il démarrera là.`,
      }),
    )
  }

  const authRequired =
    auth?.strategy === 'network' && auth.encryptedPassword != null && auth.encryptedPassword.length > 0

  let sessionToken: string | null = null
  if (authRequired) {
    const privateKey = await readFile(getAuthKeyPath(mode), 'utf-8')

    let entered = options.password
    if (entered == null) {
      const pwd = await password({ message: cliT({ en: 'OpenFox password:', fr: 'Mot de passe OpenFox :' }) })
      if (isCancel(pwd)) {
        cancel()
        process.exit(1)
      }
      entered = typeof pwd === 'string' ? pwd : ''
    }

    if (!verifyPassword(auth.encryptedPassword!, privateKey, entered)) {
      console.error(cliT({ en: 'Invalid password', fr: 'Mot de passe invalide' }))
      process.exit(1)
    }
    sessionToken = signSessionToken(privateKey, entered)
  }

  const bootstrap = buildOpenFoxMcpBootstrap({ host, port, authRequired, sessionToken })

  console.log(cliT({ en: 'OpenFox MCP client config', fr: 'Configuration client MCP OpenFox' }))
  console.log(cliT({ en: '=========================', fr: '=========================' }))
  console.log()
  console.log(cliT({ en: `Endpoint: ${bootstrap.url}`, fr: `Point de terminaison : ${bootstrap.url}` }))
  console.log()
  console.log(
    cliT({
      en: 'Paste into your MCP client (Claude Desktop, Cursor, ...):',
      fr: 'Collez dans votre client MCP (Claude Desktop, Cursor, ...) :',
    }),
  )
  console.log()
  console.log(renderMcpClientConfig(bootstrap))
}
