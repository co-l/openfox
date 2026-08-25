import { randomBytes } from 'node:crypto'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import {
  clearMcpOAuthEntry,
  clearMcpOAuthTokens,
  readMcpOAuthEntry,
  saveMcpOAuthClientInformation,
  saveMcpOAuthCodeVerifier,
  saveMcpOAuthState,
  saveMcpOAuthTokens,
} from './oauth-store.js'
import { logger } from '../utils/logger.js'

/** Where a provider keeps its credentials. Persistent for the real flow, in-memory for probes. */
interface ProviderStorage {
  read(): Promise<
    | {
        clientInformation?: OAuthClientInformationMixed
        tokens?: OAuthTokens
        codeVerifier?: string
        state?: string
      }
    | undefined
  >
  saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void>
  saveTokens(tokens: OAuthTokens): Promise<void>
  saveCodeVerifier(codeVerifier: string): Promise<void>
  saveState(state: string): Promise<void>
  clearTokens(): Promise<void>
  clearAll(): Promise<void>
}

function persistentStorage(serverName: string, serverUrl: string): ProviderStorage {
  return {
    read: () => readMcpOAuthEntry(serverName, serverUrl),
    saveClientInformation: (info) => saveMcpOAuthClientInformation(serverName, serverUrl, info),
    saveTokens: (tokens) => saveMcpOAuthTokens(serverName, serverUrl, tokens),
    saveCodeVerifier: (verifier) => saveMcpOAuthCodeVerifier(serverName, serverUrl, verifier),
    saveState: (state) => saveMcpOAuthState(serverName, serverUrl, state),
    clearTokens: () => clearMcpOAuthTokens(serverName, serverUrl),
    clearAll: () => clearMcpOAuthEntry(serverName),
  }
}

/** Ephemeral storage for background probes: nothing they touch may clobber a pending authorization. */
function memoryStorage(): ProviderStorage {
  let entry: {
    clientInformation?: OAuthClientInformationMixed
    tokens?: OAuthTokens
    codeVerifier?: string
    state?: string
  } = {}
  return {
    read: async () => entry,
    saveClientInformation: async (info) => {
      entry.clientInformation = info
    },
    saveTokens: async (tokens) => {
      entry.tokens = tokens
    },
    saveCodeVerifier: async (verifier) => {
      entry.codeVerifier = verifier
    },
    saveState: async (state) => {
      entry.state = state
    },
    clearTokens: async () => {
      delete entry.tokens
    },
    clearAll: async () => {
      entry = {}
    },
  }
}

/** API routes are mounted on literal paths, so the callback always sits at the origin root. */
const CALLBACK_PATH = '/api/mcp/oauth/callback'

let serverPort = 10369

export function setMcpOAuthServerPort(port: number): void {
  serverPort = port
}

/**
 * Where the authorization server sends the browser back.
 *
 * The loopback default is what makes this work with no configuration: the browser and the server sit
 * on the same machine for most installs, and authorization servers treat loopback redirects leniently
 * because native apps rely on them. When OpenFox is reached through a tunnel, the loopback URL is not
 * reachable from the browser, so either point OPENFOX_PUBLIC_URL at the public origin and allow that
 * redirect URI at the provider, or paste the callback URL back by hand.
 */
export function getMcpOAuthRedirectUri(): string {
  const publicUrl = process.env['OPENFOX_PUBLIC_URL']
  if (!publicUrl) return `http://127.0.0.1:${serverPort}${CALLBACK_PATH}`
  let base: URL
  try {
    base = new URL(publicUrl)
  } catch {
    throw new Error('OPENFOX_PUBLIC_URL is not a valid URL')
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error('OPENFOX_PUBLIC_URL must be an http or https URL')
  }
  // Appended rather than resolved, so a subpath deployment keeps its prefix.
  base.pathname = `${base.pathname.replace(/\/+$/, '')}${CALLBACK_PATH}`
  base.search = ''
  base.hash = ''
  return base.toString()
}

/**
 * Persists an MCP server's OAuth credentials and hands authorization URLs back to the caller.
 *
 * A browser provider would navigate on redirectToAuthorization. This one runs on the server, so it
 * records the URL instead and lets the route return it to the UI.
 */
export class McpOAuthProvider implements OAuthClientProvider {
  private authorizationUrl: URL | null = null

  constructor(
    private readonly serverName: string,
    private readonly serverUrl: string,
    private readonly redirectUri: string = getMcpOAuthRedirectUri(),
    private readonly storage: ProviderStorage = persistentStorage(serverName, serverUrl),
  ) {}

  /** Kept for log context and for callers that need the identity of the server being probed. */
  get name(): string {
    return this.serverName
  }

  get url(): string {
    return this.serverUrl
  }

  get redirectUrl(): string {
    return this.redirectUri
  }

  get clientMetadata(): OAuthClientMetadata {
    // No token_endpoint_auth_method on purpose: the SDK picks one from what the server advertises.
    return {
      client_name: 'OpenFox',
      redirect_uris: [this.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }
  }

  /** Set once the SDK has built an authorization URL, null while the stored tokens still work. */
  get pendingAuthorizationUrl(): URL | null {
    return this.authorizationUrl
  }

  async state(): Promise<string> {
    const value = randomBytes(32).toString('base64url')
    await this.storage.saveState(value)
    return value
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const entry = await this.storage.read()
    return entry?.clientInformation
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    await this.storage.saveClientInformation(clientInformation)
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const entry = await this.storage.read()
    return entry?.tokens
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.storage.saveTokens(tokens)
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = authorizationUrl
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.storage.saveCodeVerifier(codeVerifier)
  }

  async codeVerifier(): Promise<string> {
    const entry = await this.storage.read()
    if (!entry?.codeVerifier) {
      throw new Error('No stored PKCE verifier for this server, start the authorization again')
    }
    return entry.codeVerifier
  }

  /** Lets the SDK recover on its own when the server rejects the stored client or grant. */
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (scope === 'discovery') return
    if (scope === 'all' || scope === 'client') {
      // Tokens issued to a client the server no longer knows are dead too.
      await this.storage.clearAll()
      return
    }
    await this.storage.clearTokens()
  }

  /**
   * A provider whose reads and writes never reach the store.
   *
   * The transport runs one of these on every connection, and a connection happens to receive a 401
   * exactly when no valid token exists — the same moment an explicit authorization may be pending.
   * Letting that probe run against the store would overwrite the pending state and verifier with its
   * own, and the browser callback would then no longer match anything. The probe still gets a full
   * SDK flow against its private copy, so a 401 during a plain reconnect stays a plain failure.
   */
  static forBackgroundProbe(serverName: string, serverUrl: string): McpOAuthProvider {
    return new McpOAuthProvider(serverName, serverUrl, getMcpOAuthRedirectUri(), memoryStorage())
  }
}

/**
 * The authorize endpoint URL this server's flow would send the browser to, resolved the same way the
 * SDK resolves it (RFC 9728 for the authorization server, then RFC 8414/OIDC for the endpoints).
 * Only used as a liveness probe for the stored client, never to authorize anything.
 */
export async function buildOAuthProbeUrl(provider: McpOAuthProvider): Promise<URL | undefined> {
  try {
    const resource = await discoverOAuthProtectedResourceMetadata(provider.url)
    const authorizationServerUrl = resource?.authorization_servers?.[0] ?? provider.url
    const metadata = await discoverAuthorizationServerMetadata(authorizationServerUrl)
    if (!metadata?.authorization_endpoint) return undefined
    const client = await provider.clientInformation()
    if (!client) return undefined
    const url = new URL(metadata.authorization_endpoint)
    url.searchParams.set('client_id', client.client_id)
    return url
  } catch {
    return undefined
  }
}

/** Statuses an authorization server uses to say "I do not know this client". */
const STALE_CLIENT_STATUSES = new Set([401, 403])

/** Bodies that explicitly name an unknown/invalid client, as opposed to a generic invalid_request. */
function isUnknownClientBody(body: string): boolean {
  const lowered = body.toLowerCase()
  return (
    lowered.includes('unrecognized client') ||
    lowered.includes('unknown client') ||
    lowered.includes('invalid client') ||
    lowered.includes('client not found') ||
    lowered.includes('client_id not found')
  )
}

const PROBE_TIMEOUT_MS = 5000

/** Cache probe results so repeated clicks on Authorize don't add two discovery round-trips each time. */
const probeCache = new Map<string, { result: boolean; expiresAt: number }>()
const PROBE_TTL_MS = 10 * 60 * 1000

/** Reset probe cache. Only exported for tests. */
export function resetProbeCache(): void {
  probeCache.clear()
}

/**
 * Authorization servers are free to forget dynamically registered clients, and Supabase is known to
 * purge ones that never completed an authorization. A stale client id would then poison every
 * further attempt, since the SDK keeps reusing it and only recovers on errors it recognizes. An
 * authorize URL is cheap and side effect free, so it doubles as a liveness check: a rejection burns
 * the stored registration and the SDK registers a fresh client instead.
 */
export async function rejectStaleOAuthClient(
  provider: McpOAuthProvider,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const client = await provider.clientInformation()
  if (!client) return
  const cacheKey = `${provider.name}:${provider.url}:${client.client_id}`
  const cached = probeCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.result) await provider.invalidateCredentials('client')
    return
  }
  const authorizationUrl = await buildOAuthProbeUrl(provider)
  if (!authorizationUrl) return
  let response: Response
  try {
    response = await fetchImpl(authorizationUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
  } catch {
    return
  }
  const body = await response.text().catch(() => '')
  let stale = STALE_CLIENT_STATUSES.has(response.status)
  if (!stale && (response.status === 400 || response.status === 422)) {
    // A 400/422 from an authorize endpoint is usually a missing-param invalid_request, which is not
    // a stale client. Only treat it as stale when the body names an unknown/invalid client.
    stale = isUnknownClientBody(body)
  }
  probeCache.set(cacheKey, { result: stale, expiresAt: Date.now() + PROBE_TTL_MS })
  if (stale) {
    logger.warn('Discarding an OAuth client the authorization server no longer recognizes', {
      server: provider.name,
      status: response.status,
      body: body.slice(0, 200),
    })
    await provider.invalidateCredentials('client')
  }
}
