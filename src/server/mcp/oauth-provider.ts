import { randomBytes } from 'node:crypto'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
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
  ) {}

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
    await saveMcpOAuthState(this.serverName, this.serverUrl, value)
    return value
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const entry = await readMcpOAuthEntry(this.serverName, this.serverUrl)
    return entry?.clientInformation
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    await saveMcpOAuthClientInformation(this.serverName, this.serverUrl, clientInformation)
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const entry = await readMcpOAuthEntry(this.serverName, this.serverUrl)
    return entry?.tokens
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await saveMcpOAuthTokens(this.serverName, this.serverUrl, tokens)
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = authorizationUrl
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await saveMcpOAuthCodeVerifier(this.serverName, this.serverUrl, codeVerifier)
  }

  async codeVerifier(): Promise<string> {
    const entry = await readMcpOAuthEntry(this.serverName, this.serverUrl)
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
      await clearMcpOAuthEntry(this.serverName)
      return
    }
    await clearMcpOAuthTokens(this.serverName, this.serverUrl)
  }
}
