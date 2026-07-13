import { describe, expect, it, vi } from 'vitest'
import { MemoryProviderCredentialStore } from './credential-store.js'
import { OpenAIBrowserAuthAdapter } from './openai-browser-auth.js'

function jwt(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`
}

describe('OpenAIBrowserAuthAdapter', () => {
  it('creates a PKCE authorization URL and completes the callback', async () => {
    const request = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: jwt({}),
          refresh_token: 'refresh-1',
          id_token: jwt({ chatgpt_account_id: 'account-1' }),
          expires_in: 3600,
        }),
        { status: 200 },
      ),
    )
    const store = new MemoryProviderCredentialStore()
    const adapter = new OpenAIBrowserAuthAdapter(store, {
      issuer: 'https://issuer.test',
      clientId: 'client-1',
      fetch: request as typeof fetch,
      now: () => 1000,
    })

    const challenge = await adapter.beginLoginForProvider('provider-1', 'http://localhost/callback')
    const authUrl = new URL(challenge.url)
    const result = await adapter.completeLogin('code-1', authUrl.searchParams.get('state')!)

    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(result.providerId).toBe('provider-1')
    expect(await adapter.getStatus(result.credentialRef)).toEqual({
      state: 'connected',
      accountLabel: 'account-1',
    })
    expect(await adapter.getAccessContext(result.credentialRef)).toEqual(
      expect.objectContaining({
        accountId: 'account-1',
        headers: expect.objectContaining({ 'ChatGPT-Account-Id': 'account-1' }),
      }),
    )
  })

  it('rejects unknown callback state', async () => {
    const adapter = new OpenAIBrowserAuthAdapter(new MemoryProviderCredentialStore())
    await expect(adapter.completeLogin('code', 'unknown')).rejects.toThrow('invalid or expired')
  })
})
