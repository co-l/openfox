import { describe, expect, it } from 'vitest'
import { MemoryProviderCredentialStore, type OAuthCredential } from './credential-store.js'

const credential: OAuthCredential = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: 123456,
  accountId: 'account-1',
}

describe('MemoryProviderCredentialStore', () => {
  it('creates and reads credentials by opaque reference', async () => {
    const store = new MemoryProviderCredentialStore()

    const reference = await store.create(credential)

    expect(reference).not.toContain('access-token')
    expect(await store.get(reference)).toEqual(credential)
  })

  it('returns copies so callers cannot mutate stored credentials', async () => {
    const store = new MemoryProviderCredentialStore()
    const reference = await store.create(credential)
    const loaded = await store.get(reference)

    loaded!.accessToken = 'changed'

    expect((await store.get(reference))?.accessToken).toBe('access-token')
  })

  it('updates and deletes existing credentials', async () => {
    const store = new MemoryProviderCredentialStore()
    const reference = await store.create(credential)

    await store.set(reference, { ...credential, accessToken: 'new-access-token' })
    expect((await store.get(reference))?.accessToken).toBe('new-access-token')

    await store.delete(reference)
    expect(await store.get(reference)).toBeUndefined()
  })

  it('rejects updates for unknown references', async () => {
    const store = new MemoryProviderCredentialStore()

    await expect(store.set('missing', credential)).rejects.toThrow('Credential not found: missing')
  })
})
