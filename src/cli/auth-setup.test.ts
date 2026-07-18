import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { access, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateKeyPairSync } from 'node:crypto'

const TEST_DIR = join(tmpdir(), `openfox-auth-setup-test-${Date.now()}`)

vi.mock('./paths.js', () => ({
  getGlobalConfigDir: () => TEST_DIR,
  getGlobalConfigPath: () => join(TEST_DIR, 'config.json'),
  getAuthConfigPath: () => join(TEST_DIR, 'auth.json'),
  getAuthKeyPath: () => join(TEST_DIR, 'auth.key'),
}))

describe('auth setup on fresh install', () => {
  beforeEach(async () => {
    vi.resetModules()
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  it('creates config directory and auth files when directory does not exist', async () => {
    const { saveAuthConfig, encryptPassword } = await import('./auth.js')
    const { getAuthKeyPath } = await import('./paths.js')

    // Verify directory does not exist before
    await expect(access(TEST_DIR)).rejects.toThrow()

    // Generate key pair
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    })

    const encryptedPassword = encryptPassword('test123', publicKey)

    // This reproduces the exact order of operations from runNetworkSetup:
    // 1. saveAuthConfig creates the directory
    // 2. writeFile writes auth.key into that directory
    // Before the fix, writeFile was called before saveAuthConfig,
    // causing ENOENT because the directory didn't exist yet.
    await saveAuthConfig('production', {
      strategy: 'network',
      encryptedPassword,
    })

    const keyPath = getAuthKeyPath('production')
    await writeFile(keyPath, privateKey, { mode: 0o600 })

    // Directory must exist after setup
    await expect(access(TEST_DIR)).resolves.toBeUndefined()

    // auth.json must exist
    const authPath = join(TEST_DIR, 'auth.json')
    await expect(access(authPath)).resolves.toBeUndefined()

    // auth.key must exist
    await expect(access(keyPath)).resolves.toBeUndefined()

    // Verify auth.key contains valid PEM private key
    const keyContent = await readFile(keyPath, 'utf-8')
    expect(keyContent).toContain('-----BEGIN PRIVATE KEY-----')
    expect(keyContent).toContain('-----END PRIVATE KEY-----')

    // Verify auth.json contains expected structure
    const authContent = await readFile(authPath, 'utf-8')
    const authData = JSON.parse(authContent)
    expect(authData.strategy).toBe('network')
    expect(authData.encryptedPassword).toBe(encryptedPassword)
  })
})
