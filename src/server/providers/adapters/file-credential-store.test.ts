import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileProviderCredentialStore } from './file-credential-store.js'

describe('FileProviderCredentialStore', () => {
  it('persists encrypted credentials without plaintext tokens', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openfox-credentials-'))
    const path = join(dir, 'credentials.json')
    const keyPath = join(dir, 'credentials.key')
    const store = new FileProviderCredentialStore(path, keyPath)

    const reference = await store.create({
      accessToken: 'very-secret-access',
      refreshToken: 'very-secret-refresh',
      expiresAt: 123,
    })

    expect(await store.get(reference)).toEqual({
      accessToken: 'very-secret-access',
      refreshToken: 'very-secret-refresh',
      expiresAt: 123,
    })
    expect(await readFile(path, 'utf8')).not.toContain('very-secret')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(keyPath)).mode & 0o777).toBe(0o600)
  })
})
