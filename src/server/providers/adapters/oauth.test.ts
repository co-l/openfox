import { describe, expect, it } from 'vitest'
import { createOAuthState, createPkcePair } from './oauth.js'

describe('OAuth helpers', () => {
  it('creates an RFC 7636 compatible PKCE pair', async () => {
    const pair = await createPkcePair()

    expect(pair.verifier).toMatch(/^[A-Za-z0-9._~-]{43}$/)
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(pair.challenge).not.toContain('=')
  })

  it('creates random URL-safe state values', () => {
    const first = createOAuthState()
    const second = createOAuthState()

    expect(first).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(first).not.toBe(second)
  })
})
