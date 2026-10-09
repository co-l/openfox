import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  constants,
  createPublicKey,
  createVerify,
  generateKeyPairSync,
  publicEncrypt,
} from 'node:crypto'
import type { Config } from '../shared/types.js'
import {
  requiresAuth,
  hasPassword,
  verifyPassword,
  isValidToken,
  tokenFromPassword,
  currentSessionToken,
  resetAuthCache,
  loadServerAuthConfig,
  getAuthConfig,
  hashPassword,
  decryptPassword,
  signPasswordToken,
} from './auth.js'
import { setRuntimeConfig } from './runtime-config.js'

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

function encrypt(password: string, padding: number = constants.RSA_PKCS1_OAEP_PADDING): string {
  return publicEncrypt(
    { key: publicKey, padding, oaepHash: 'sha256' },
    Buffer.from(password),
  ).toString('base64')
}

function verifyToken(token: string, password: string): boolean {
  const verifier = createVerify('SHA256')
  verifier.update(hashPassword(password))
  verifier.end()
  return verifier.verify(publicKey, token, 'base64')
}

let authDir: string

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    mode: 'production',
    llm: { baseUrl: '', model: '', backend: 'unknown', timeout: 300000, idleTimeout: 300000 },
    context: { maxTokens: 100000, compactionThreshold: 0.85, compactionTarget: 0.6 },
    agent: { maxIterations: 10, maxConsecutiveFailures: 3, toolTimeout: 120000 },
    server: { port: 0, host: '127.0.0.1' },
    database: { path: ':memory:' },
    logging: { level: 'error' },
    workdir: '/tmp',
    authDir,
    ...overrides,
  }
}

async function startServer(overrides: Partial<Config> = {}): Promise<void> {
  setRuntimeConfig(makeConfig(overrides))
  resetAuthCache()
}

async function writeAuthConfig(config: Record<string, unknown>): Promise<void> {
  await writeFile(join(authDir, 'auth.json'), JSON.stringify(config))
}

async function writeKey(pem: string): Promise<void> {
  await writeFile(join(authDir, 'auth.key'), pem, { mode: 0o600 })
}

describe('auth', () => {
  beforeEach(async () => {
    authDir = await mkdtemp(join(tmpdir(), 'openfox-auth-'))
  })

  afterEach(async () => {
    resetAuthCache()
    await rm(authDir, { recursive: true, force: true })
  })

  describe('without an auth config', () => {
    it('loads null and keeps auth disabled', async () => {
      await startServer()
      expect(await loadServerAuthConfig()).toBeNull()
      expect(requiresAuth()).toBe(false)
      expect(hasPassword()).toBe(false)
    })

    it('rejects passwords and tokens', async () => {
      await startServer()
      expect(await verifyPassword('testpassword')).toBe(false)
      expect(await isValidToken('sometoken')).toBe(false)
      expect(await isValidToken('')).toBe(false)
      expect(await currentSessionToken()).toBeNull()
    })

    it('still mints tokens, generating the key inside authDir', async () => {
      await startServer()
      const token = await tokenFromPassword('testpassword')

      const key = await readFile(join(authDir, 'auth.key'), 'utf-8')
      const derivedPublicKey = createPublicKey(key).export({ type: 'spki', format: 'pem' })
      const verifier = createVerify('SHA256')
      verifier.update(hashPassword('testpassword'))
      verifier.end()
      expect(verifier.verify(derivedPublicKey, token, 'base64')).toBe(true)
    })
  })

  describe('with network strategy and a password', () => {
    beforeEach(async () => {
      await writeKey(privateKey)
      await writeAuthConfig({ strategy: 'network', encryptedPassword: encrypt('correctpassword') })
      await startServer()
      await loadServerAuthConfig()
    })

    it('requires auth and exposes the stored password', () => {
      expect(requiresAuth()).toBe(true)
      expect(hasPassword()).toBe(true)
      const config = getAuthConfig()
      expect(config?.strategy).toBe('network')
      // OAEP is randomized, so compare by decryption rather than by ciphertext
      expect(decryptPassword(privateKey, config!.encryptedPassword!)?.toString()).toBe('correctpassword')
    })

    it('accepts the correct password and rejects a wrong one', async () => {
      expect(await verifyPassword('correctpassword')).toBe(true)
      expect(await verifyPassword('wrongpassword')).toBe(false)
    })

    it('accepts a legacy PKCS1-encrypted password', async () => {
      await writeAuthConfig({ strategy: 'network', encryptedPassword: encrypt('legacypassword', constants.RSA_PKCS1_PADDING) })
      resetAuthCache()
      await loadServerAuthConfig()

      expect(await verifyPassword('legacypassword')).toBe(true)
    })
  })

  describe('strategy variants', () => {
    it('does not require auth with local strategy', async () => {
      await writeKey(privateKey)
      await writeAuthConfig({ strategy: 'local', encryptedPassword: encrypt('whatever') })
      await startServer()
      await loadServerAuthConfig()

      expect(requiresAuth()).toBe(false)
      expect(hasPassword()).toBe(true)
    })

    it('reports no password when encryptedPassword is null or empty', async () => {
      await writeAuthConfig({ strategy: 'network', encryptedPassword: null })
      await startServer()
      await loadServerAuthConfig()
      expect(hasPassword()).toBe(false)
      expect(await verifyPassword('x')).toBe(false)

      await writeAuthConfig({ strategy: 'network', encryptedPassword: '' })
      resetAuthCache()
      await loadServerAuthConfig()
      expect(hasPassword()).toBe(false)
    })
  })

  describe('caching', () => {
    it('serves the cached config until reset, in every mode', async () => {
      await writeKey(privateKey)
      const encrypted = encrypt('stored')
      await writeAuthConfig({ strategy: 'network', encryptedPassword: encrypted })
      await startServer({ mode: 'test' })
      await loadServerAuthConfig()

      await writeAuthConfig({ strategy: 'local', encryptedPassword: null })
      expect(await loadServerAuthConfig()).toEqual({ strategy: 'network', encryptedPassword: encrypted })

      resetAuthCache()
      expect(await loadServerAuthConfig()).toEqual({ strategy: 'local', encryptedPassword: null })
    })
  })

  describe('isValidToken', () => {
    beforeEach(async () => {
      await writeKey(privateKey)
      await writeAuthConfig({ strategy: 'network', encryptedPassword: encrypt('storedpassword') })
      await startServer()
      await loadServerAuthConfig()
    })

    it('accepts a token minted for the stored password', async () => {
      const token = await tokenFromPassword('storedpassword')
      expect(await isValidToken(token)).toBe(true)
    })

    it('rejects an invalid token', async () => {
      expect(await isValidToken('invalidtoken')).toBe(false)
    })

    it('accepts a token for a legacy PKCS1-encrypted password', async () => {
      await writeAuthConfig({ strategy: 'network', encryptedPassword: encrypt('storedpassword', constants.RSA_PKCS1_PADDING) })
      resetAuthCache()
      await loadServerAuthConfig()

      expect(await isValidToken(await tokenFromPassword('storedpassword'))).toBe(true)
    })
  })

  describe('currentSessionToken', () => {
    it('returns a token that verifies against the stored password', async () => {
      await writeKey(privateKey)
      await writeAuthConfig({ strategy: 'network', encryptedPassword: encrypt('sessionpassword') })
      await startServer()
      await loadServerAuthConfig()

      const token = await currentSessionToken()
      expect(token).not.toBeNull()
      expect(verifyToken(token!, 'sessionpassword')).toBe(true)
    })

    it('returns null when no password is stored', async () => {
      await writeAuthConfig({ strategy: 'network', encryptedPassword: null })
      await startServer()
      await loadServerAuthConfig()

      expect(await currentSessionToken()).toBeNull()
    })
  })

  describe('hashPassword', () => {
    it('produces a consistent 64-char hex digest', () => {
      expect(hashPassword('mypassword')).toBe(hashPassword('mypassword'))
      expect(hashPassword('password1')).not.toBe(hashPassword('password2'))
      expect(hashPassword('test')).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  describe('decryptPassword (pure)', () => {
    it('decrypts OAEP and legacy PKCS1 payloads', () => {
      expect(decryptPassword(privateKey, encrypt('hunter2'))?.toString()).toBe('hunter2')
      expect(decryptPassword(privateKey, encrypt('hunter2', constants.RSA_PKCS1_PADDING))?.toString()).toBe('hunter2')
    })

    it('returns null for malformed input', () => {
      expect(decryptPassword(privateKey, 'not-base64-!!!')).toBeNull()
      // full-size garbage must not be mistaken for a decrypted password
      expect(decryptPassword(privateKey, Buffer.alloc(256, 0xab).toString('base64'))).toBeNull()
    })

    it('accepts a legacy block with the minimum eight padding bytes', () => {
      // PKCS#1 (RFC 8017) allows exactly 8 padding bytes, so a 245-byte
      // message is the longest valid payload for a 2048-bit key
      const message = Buffer.alloc(245, 0x41)
      const block = Buffer.concat([
        Buffer.from([0x00, 0x02]),
        Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
        Buffer.from([0x00]),
        message,
      ])
      expect(block.length).toBe(256)
      const ciphertext = publicEncrypt(
        { key: publicKey, padding: constants.RSA_NO_PADDING },
        block,
      ).toString('base64')

      expect(decryptPassword(privateKey, ciphertext)?.toString()).toBe(message.toString())
    })

    it('accepts a valid ciphertext when the key bit length is not a multiple of eight', () => {
      const { privateKey: key, publicKey: pub } = generateKeyPairSync('rsa', {
        modulusLength: 2050,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      })
      const ciphertext = publicEncrypt(
        { key: pub, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        Buffer.from('s3cret'),
      ).toString('base64')
      expect(Buffer.from(ciphertext, 'base64').length).toBe(257)
      expect(decryptPassword(key, ciphertext)?.toString()).toBe('s3cret')
    })
  })

  describe('signPasswordToken (pure)', () => {
    it('produces a token that verifies against the public key', () => {
      const token = signPasswordToken(privateKey, 'hunter2')
      expect(verifyToken(token, 'hunter2')).toBe(true)
      expect(token).not.toBe(signPasswordToken(privateKey, 'other'))
    })
  })
})
