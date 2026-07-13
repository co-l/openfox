import { describe, expect, it, vi } from 'vitest'
import { MemoryProviderCredentialStore } from './credential-store.js'
import { extractOpenAIAccountId, OpenAIAccountTokenClient } from './openai-account.js'

function jwt(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`
}

describe('extractOpenAIAccountId', () => {
  it('reads the direct ChatGPT account claim', () => {
    expect(extractOpenAIAccountId(jwt({ chatgpt_account_id: 'account-1' }))).toBe('account-1')
  })

  it('falls back to the namespaced claim and organization', () => {
    expect(
      extractOpenAIAccountId(jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'account-2' } })),
    ).toBe('account-2')
    expect(extractOpenAIAccountId(jwt({ organizations: [{ id: 'org-1' }] }))).toBe('org-1')
  })

  it('returns undefined for malformed tokens', () => {
    expect(extractOpenAIAccountId('invalid')).toBeUndefined()
  })
})

describe('OpenAIAccountTokenClient', () => {
  it('exchanges an authorization code and extracts account metadata', async () => {
    const request = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: jwt({}),
          refresh_token: 'refresh-1',
          id_token: jwt({ chatgpt_account_id: 'account-1' }),
          expires_in: 60,
        }),
        { status: 200 },
      ),
    )
    const client = new OpenAIAccountTokenClient(new MemoryProviderCredentialStore(), {
      issuer: 'https://issuer.test',
      fetch: request as typeof fetch,
      now: () => 1000,
    })

    const credential = await client.exchangeCode('code-1', 'http://localhost/callback', 'verifier-1')

    expect(credential).toEqual(
      expect.objectContaining({ refreshToken: 'refresh-1', accountId: 'account-1', expiresAt: 61000 }),
    )
    expect(request).toHaveBeenCalledWith(
      'https://issuer.test/oauth/token',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('coalesces concurrent refreshes and persists rotated tokens', async () => {
    const store = new MemoryProviderCredentialStore()
    const reference = await store.create({
      accessToken: 'expired',
      refreshToken: 'refresh-old',
      expiresAt: 0,
      accountId: 'account-1',
    })
    const request = vi.fn(async () =>
      new Response(
        JSON.stringify({ access_token: jwt({}), refresh_token: 'refresh-new', expires_in: 3600 }),
        { status: 200 },
      ),
    )
    const client = new OpenAIAccountTokenClient(store, {
      issuer: 'https://issuer.test',
      fetch: request as typeof fetch,
      now: () => 1000,
    })

    const [first, second] = await Promise.all([
      client.getValidCredential(reference),
      client.getValidCredential(reference),
    ])

    expect(request).toHaveBeenCalledTimes(1)
    expect(first.refreshToken).toBe('refresh-new')
    expect(second.accountId).toBe('account-1')
    expect((await store.get(reference))?.refreshToken).toBe('refresh-new')
  })
})
