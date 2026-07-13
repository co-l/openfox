import type { OAuthCredential, ProviderCredentialStore } from './credential-store.js'

export const OPENAI_ACCOUNT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const OPENAI_ACCOUNT_ISSUER = 'https://auth.openai.com'

interface OpenAITokenResponse {
  id_token?: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

interface OpenAIClaims {
  chatgpt_account_id?: string
  organizations?: Array<{ id: string }>
  email?: string
  'https://api.openai.com/auth'?: { chatgpt_account_id?: string }
}

export interface OpenAIAccountTokenClientOptions {
  issuer?: string
  clientId?: string
  fetch?: typeof fetch
  now?: () => number
}

export class OpenAIAccountTokenClient {
  private readonly issuer: string
  private readonly clientId: string
  private readonly request: typeof fetch
  private readonly now: () => number
  private readonly refreshes = new Map<string, Promise<OAuthCredential>>()

  constructor(
    private readonly credentials: ProviderCredentialStore,
    options: OpenAIAccountTokenClientOptions = {},
  ) {
    this.issuer = options.issuer ?? OPENAI_ACCOUNT_ISSUER
    this.clientId = options.clientId ?? OPENAI_ACCOUNT_CLIENT_ID
    this.request = options.fetch ?? fetch
    this.now = options.now ?? Date.now
  }

  async exchangeCode(code: string, redirectUri: string, verifier: string): Promise<OAuthCredential> {
    return this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: this.clientId,
      code_verifier: verifier,
    })
  }

  async getValidCredential(reference: string): Promise<OAuthCredential> {
    const credential = await this.credentials.get(reference)
    if (!credential) throw new Error('OpenAI account credential not found')
    if (credential.expiresAt > this.now() + 30_000) return credential

    let refresh = this.refreshes.get(reference)
    if (!refresh) {
      refresh = this.refreshCredential(reference, credential)
      this.refreshes.set(reference, refresh)
      void refresh.finally(() => this.refreshes.delete(reference))
    }
    return refresh
  }

  private async refreshCredential(reference: string, current: OAuthCredential): Promise<OAuthCredential> {
    const refreshed = await this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: this.clientId,
    })
    const accountId = refreshed.accountId ?? current.accountId
    const merged: OAuthCredential = {
      ...refreshed,
      ...(accountId && { accountId }),
    }
    await this.credentials.set(reference, merged)
    return merged
  }

  private async tokenRequest(body: Record<string, string>): Promise<OAuthCredential> {
    const response = await this.request(`${this.issuer}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    })
    if (!response.ok) throw new Error(`OpenAI token request failed: ${response.status}`)

    const tokens = (await response.json()) as OpenAITokenResponse
    const accountId = extractOpenAIAccountId(tokens.id_token ?? tokens.access_token)
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: this.now() + (tokens.expires_in ?? 3600) * 1000,
      ...(tokens.id_token && { idToken: tokens.id_token }),
      ...(accountId && { accountId }),
    }
  }
}

export function extractOpenAIAccountId(token: string): string | undefined {
  const payload = token.split('.')[1]
  if (!payload) return undefined
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as OpenAIClaims
    return (
      claims.chatgpt_account_id ??
      claims['https://api.openai.com/auth']?.chatgpt_account_id ??
      claims.organizations?.[0]?.id
    )
  } catch {
    return undefined
  }
}
