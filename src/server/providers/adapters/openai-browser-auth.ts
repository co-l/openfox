import type { ProviderCredentialStore } from './credential-store.js'
import { createOAuthState, createPkcePair } from './oauth.js'
import {
  OPENAI_ACCOUNT_CLIENT_ID,
  OPENAI_ACCOUNT_ISSUER,
  OpenAIAccountTokenClient,
} from './openai-account.js'
import type {
  ProviderAccessContext,
  ProviderAuthAdapter,
  ProviderAuthStatus,
  ProviderLoginChallenge,
} from './types.js'

interface PendingLogin {
  providerId: string
  verifier: string
  redirectUri: string
  createdAt: number
}

export interface OpenAIBrowserAuthOptions {
  issuer?: string
  clientId?: string
  now?: () => number
  fetch?: typeof fetch
}

export class OpenAIBrowserAuthAdapter implements ProviderAuthAdapter {
  readonly id = 'openai-account'
  private readonly pending = new Map<string, PendingLogin>()
  private readonly issuer: string
  private readonly clientId: string
  private readonly now: () => number
  private readonly tokens: OpenAIAccountTokenClient

  constructor(
    private readonly credentials: ProviderCredentialStore,
    options: OpenAIBrowserAuthOptions = {},
  ) {
    this.issuer = options.issuer ?? OPENAI_ACCOUNT_ISSUER
    this.clientId = options.clientId ?? OPENAI_ACCOUNT_CLIENT_ID
    this.now = options.now ?? Date.now
    this.tokens = new OpenAIAccountTokenClient(credentials, options)
  }

  async beginLoginForProvider(providerId: string, redirectUri: string): Promise<ProviderLoginChallenge> {
    this.removeExpiredPending()
    const state = createOAuthState()
    const pkce = await createPkcePair()
    this.pending.set(state, { providerId, verifier: pkce.verifier, redirectUri, createdAt: this.now() })

    const url = new URL(`${this.issuer}/oauth/authorize`)
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: 'openid profile email offline_access',
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      state,
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
    }).toString()

    return { url: url.toString(), instructions: 'Complete sign-in in your browser.', mode: 'browser' }
  }

  async completeLogin(code: string, state: string): Promise<{ providerId: string; credentialRef: string }> {
    const pending = this.pending.get(state)
    this.pending.delete(state)
    if (!pending || this.now() - pending.createdAt > 10 * 60_000) {
      throw new Error('OAuth state is invalid or expired')
    }
    const credential = await this.tokens.exchangeCode(code, pending.redirectUri, pending.verifier)
    const credentialRef = await this.credentials.create(credential)
    return { providerId: pending.providerId, credentialRef }
  }

  async getStatus(credentialRef?: string): Promise<ProviderAuthStatus> {
    if (!credentialRef) return { state: 'disconnected' }
    try {
      const credential = await this.credentials.get(credentialRef)
      if (!credential) return { state: 'disconnected' }
      return {
        state: credential.expiresAt <= this.now() ? 'expired' : 'connected',
        ...(credential.accountId && { accountLabel: credential.accountId }),
      }
    } catch (error) {
      return { state: 'error', error: error instanceof Error ? error.message : String(error) }
    }
  }

  async beginLogin(): Promise<ProviderLoginChallenge> {
    throw new Error('Use beginLoginForProvider with a callback URL')
  }

  async getAccessContext(credentialRef: string): Promise<ProviderAccessContext> {
    const credential = await this.tokens.getValidCredential(credentialRef)
    return {
      accessToken: credential.accessToken,
      ...(credential.accountId && { accountId: credential.accountId }),
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        ...(credential.accountId && { 'ChatGPT-Account-Id': credential.accountId }),
      },
    }
  }

  async logout(credentialRef: string): Promise<void> {
    await this.credentials.delete(credentialRef)
  }

  private removeExpiredPending(): void {
    const cutoff = this.now() - 10 * 60_000
    for (const [state, pending] of this.pending) {
      if (pending.createdAt < cutoff) this.pending.delete(state)
    }
  }
}
